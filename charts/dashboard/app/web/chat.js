// Media chat. Everything it needs is in this file, so if /api is down only the panel shows an error.
const chat = document.getElementById("chat");
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const store = {
  load() {
    try {
      return JSON.parse(localStorage.getItem("chat")) ?? { messages: [] };
    } catch {
      return { messages: [] };
    }
  },
  save() {
    try {
      localStorage.setItem(
        "chat",
        JSON.stringify({ ...state, messages: state.messages.filter((m) => m.text || m.cost) }),
      );
    } catch {
      // Storage can be full or blocked (private windows); the chat still works, it just won't survive a reload.
    }
  },
};
let state = store.load();

const openChat = () => {
  chat.inert = false;
  chat.classList.remove("translate-x-full");
  chatInput.focus();
};
const closeChat = () => {
  chat.inert = true;
  chat.classList.add("translate-x-full");
};
const chatIsOpen = () => !chat.inert;

// /#chat shows the chat as a full page. Switching only changes the URL, never reloads,
// so a reply that is still streaming and a half-typed message survive the move.
const isFullPage = () => location.hash === "#chat";
const applyMode = () => {
  const full = isFullPage();
  chat.classList.toggle("sm:w-[30rem]", !full);
  chat.classList.toggle("bg-slate-950/95", !full);
  chat.classList.toggle("bg-slate-950", full);
  for (const el of [chatLog, chatForm]) el.classList.toggle("px-[max(1.25rem,calc((100%-48rem)/2))]", full);
  document.getElementById("chat-full").hidden = full;
  document.getElementById("chat-crumb").hidden = !full;
  if (full) openChat();
  else closeChat();
};
const goToDashboard = () => {
  history.pushState(null, "", "/");
  applyMode();
};
const leaveChat = () => (isFullPage() ? goToDashboard() : closeChat());
applyMode();
addEventListener("hashchange", applyMode);
addEventListener("popstate", applyMode);
document.getElementById("chat-home").addEventListener("click", (e) => {
  // Let modified clicks open the dashboard in a new tab as usual.
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  goToDashboard();
});
document.getElementById("chat-open").addEventListener("click", openChat);
document.getElementById("chat-close").addEventListener("click", leaveChat);
document.addEventListener("keydown", (e) => {
  if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (chatIsOpen()) leaveChat();
    else openChat();
  }
  if (e.key === "Escape" && chatIsOpen() && !document.getElementById("palette").open) leaveChat();
});

// Model output includes web and review text, so it is untrusted: always sanitise.
const markdown = (text) => {
  if (!window.marked || !window.DOMPurify)
    return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return DOMPurify.sanitize(marked.parse(text));
};

const money = (usd) => `≈ $${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
const chatCost = document.getElementById("chat-cost");
const updateTotal = () => {
  const total = state.messages.reduce((sum, m) => sum + (m.cost ?? 0), 0);
  chatCost.textContent = total ? money(total) : "";
};

const addMessage = (role, text = "", cost) => {
  const el = document.createElement("div");
  el.className =
    role === "user"
      ? "ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-sky-500/15 px-4 py-2.5 text-sm"
      : role === "error"
        ? "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200"
        : "prose prose-sm prose-invert max-w-none prose-headings:mb-1 prose-headings:mt-4 prose-img:my-2 prose-img:max-h-48 prose-img:rounded-lg prose-a:text-sky-400";
  const body = document.createElement("div");
  const chips = document.createElement("div");
  chips.className = "not-prose mt-1 flex flex-wrap gap-1.5";
  const costLine = document.createElement("div");
  costLine.className = "not-prose mt-1 text-xs tabular-nums text-slate-600";
  el.append(body, chips, costLine);
  const render = (t) => {
    if (role === "assistant") body.innerHTML = markdown(t);
    else body.textContent = t;
  };
  const setCost = (usd) => (costLine.textContent = usd ? money(usd) : "");
  render(text);
  setCost(cost);
  chatLog.append(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return { render, chips, setCost };
};

const renderAll = () => {
  chatLog.innerHTML = "";
  if (!state.messages.length) {
    chatLog.innerHTML = `<p class="pt-10 text-center text-sm text-slate-500">Ask what to watch tonight, what's downloading,<br>or tell it to get a title.</p>`;
  }
  for (const m of state.messages) addMessage(m.role, m.text, m.cost);
  updateTotal();
};

document.getElementById("chat-new").addEventListener("click", () => {
  state = { messages: [] };
  store.save();
  renderAll();
  chatInput.focus();
});

async function send(message) {
  if (!state.messages.length) chatLog.innerHTML = "";
  state.messages.push({ role: "user", text: message });
  addMessage("user", message);
  const reply = { role: "assistant", text: "" };
  state.messages.push(reply);
  const view = addMessage("assistant");
  store.save();
  let lastChip = "";
  const fail = (text) => {
    state.messages.push({ role: "error", text });
    addMessage("error", text);
  };
  chatSend.disabled = true;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        previousResponseId: state.responseId,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const [eventLine, dataLine] = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const event = eventLine.slice("event: ".length);
        const data = JSON.parse(dataLine.slice("data: ".length));
        if (event === "text") {
          reply.text += data.delta;
          view.render(reply.text);
        } else if (event === "progress" && data.label !== lastChip) {
          lastChip = data.label;
          const chip = document.createElement("span");
          chip.className = "rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-400";
          chip.textContent = data.label;
          view.chips.append(chip);
        } else if (event === "usage") {
          reply.cost = (reply.cost ?? 0) + data.cost;
          view.setCost(reply.cost);
          updateTotal();
        } else if (event === "done") {
          state.responseId = data.responseId;
        } else if (event === "error") {
          fail(data.message);
        }
        // Saved as it streams, so a reload keeps what has arrived so far.
        store.save();
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }
  } catch (e) {
    fail(`Can't reach the chat backend (${e.message}). The rest of the dashboard still works.`);
  } finally {
    view.chips.remove();
    // A turn that failed before writing anything may still have cost money; keep that on record.
    if (!reply.text && !reply.cost) state.messages.splice(state.messages.indexOf(reply), 1);
    store.save();
    chatSend.disabled = false;
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message || chatSend.disabled) return;
  chatInput.value = "";
  chatInput.style.height = "";
  send(message);
});
// Grow with the text, up to the max height.
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = `${chatInput.scrollHeight}px`;
});
// A chat open in two tabs shares storage; show what the other tab saved.
addEventListener("storage", (e) => {
  if (e.key !== "chat") return;
  state = store.load();
  renderAll();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
// Deferred scripts (marked, DOMPurify) have run by DOMContentLoaded.
addEventListener("DOMContentLoaded", () => {
  window.DOMPurify?.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
    // Text planted in a web page or review could make the model emit an image whose URL
    // carries your data off-site the moment it renders. Posters only ever come from TMDB.
    if (node.tagName === "IMG") {
      node.removeAttribute("srcset");
      if (!node.getAttribute("src")?.startsWith("https://image.tmdb.org/")) node.removeAttribute("src");
    }
  });
  renderAll();
});
