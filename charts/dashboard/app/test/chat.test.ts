// The chat endpoint: streaming, request guards, cost reporting, retries and limits.
import { afterEach, expect, test } from "bun:test";
import { fakeOpenAI, reply, setup, stopFakes, toolCall, toolOutput } from "./fakes.ts";

afterEach(stopFakes);

test("plain text streams through as text events, then done with the response id", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([reply("resp_1", "Hello", " there")]) });

  const events = await chat({ message: "hi" });

  expect(events).toEqual([
    { event: "text", data: { delta: "Hello" } },
    { event: "text", data: { delta: " there" } },
    { event: "done", data: { responseId: "resp_1" } },
  ]);
  const request = openai.calls[0]!;
  expect(request.headers.get("authorization")).toBe("Bearer sk-test");
  expect(request.body).toMatchObject({
    model: "test-model",
    instructions: "test prompt",
    stream: true,
    input: [{ role: "user", content: "hi" }],
  });
  expect(request.body.tools).toContainEqual({ type: "web_search" });
  expect(request.body.previous_response_id).toBeUndefined();
});

test("cross-site requests are refused before reaching OpenAI", async () => {
  const { url, openai } = setup({ openai: fakeOpenAI([reply("resp_1", "should not run")]) });
  const post = (headers: Record<string, string>) =>
    fetch(`${url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "get heat" }) });

  // A form or no-cors fetch from another site can only send "simple" content types like text/plain.
  expect((await post({ "content-type": "text/plain" })).status).toBe(415);
  expect((await post({ "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await post({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status).toBe(200);
  await Bun.sleep(50);
  expect(openai.calls).toHaveLength(1);
});

test("each OpenAI request's cost is reported as a usage event", async () => {
  const completed = (id: string, output: unknown[], usage: unknown) => ({
    type: "response.completed",
    response: { id, status: "completed", output, usage },
  });
  const call = { type: "function_call", call_id: "call_1", name: "get_queue", arguments: "{}" };
  const { chat } = setup({
    openai: fakeOpenAI([
      [
        completed("resp_1", [{ type: "web_search_call" }, call], {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 400 },
          output_tokens: 200,
        }),
      ],
      [completed("resp_2", [{ type: "message" }], { input_tokens: 2000, output_tokens: 100 })],
    ]),
    sonarr: { "GET /api/v3/queue": () => ({ records: [] }) },
    radarr: { "GET /api/v3/queue": () => ({ records: [] }) },
  });

  const events = await chat({ message: "what's downloading?" });

  // (600 × $1 + 400 × $0.10 + 200 × $4) / 1M + one search at $0.01, then (2000 × $1 + 100 × $4) / 1M.
  const costs = events.filter((e) => e.event === "usage").map((e) => e.data.cost);
  expect(costs).toEqual([0.01144, 0.0024].map((c) => expect.closeTo(c, 10)));
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_2" } });
});

test("previousResponseId is forwarded to OpenAI", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([reply("resp_2", "ok")]) });

  await chat({ message: "and another", previousResponseId: "resp_1" });

  expect(openai.calls[0]!.body.previous_response_id).toBe("resp_1");
});

test("a tool round: get_queue hits Sonarr and Radarr and the result goes back to OpenAI", async () => {
  const { chat, openai, sonarr, radarr } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "get_queue"), reply("resp_2", "Two things are downloading.")]),
    sonarr: {
      "GET /api/v3/queue": () => ({
        records: [
          {
            title: "Show.S01E02.1080p",
            size: 1e9,
            sizeleft: 2.5e8,
            series: { title: "Severance" },
            episode: { seasonNumber: 1, episodeNumber: 2 },
            quality: { quality: { name: "WEBDL-1080p" } },
          },
        ],
      }),
    },
    radarr: {
      "GET /api/v3/queue": () => ({
        records: [{ title: "Heat.1995.1080p", size: 8e9, sizeleft: 8e9, movie: { title: "Heat", year: 1995 } }],
      }),
    },
  });

  const events = await chat({ message: "what's downloading?" });

  expect(events).toContainEqual({ event: "progress", data: { label: "Checking the download queue…" } });
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_2" } });
  expect(sonarr.calls[0]!.headers.get("x-api-key")).toBe("sonarr-key");
  expect(radarr.calls[0]!.headers.get("x-api-key")).toBe("radarr-key");
  const second = openai.calls[1]!.body;
  expect(second.previous_response_id).toBe("resp_1");
  expect(second.input[0]).toMatchObject({ type: "function_call_output", call_id: "call_resp_1" });
  expect(toolOutput(openai, 1)).toMatchObject([
    { app: "Sonarr", title: "Severance S01E02", progress: "75%", quality: "WEBDL-1080p" },
    { app: "Radarr", title: "Heat (1995)", progress: "0%" },
  ]);
});

test("keep-alive progress events are sent during a slow tool", async () => {
  const { chat } = setup(
    {
      openai: fakeOpenAI([toolCall("resp_1", "get_queue"), reply("resp_2", "Nothing.")]),
      sonarr: { "GET /api/v3/queue": async () => (await Bun.sleep(250), { records: [] }) },
      radarr: { "GET /api/v3/queue": () => ({ records: [] }) },
    },
    { keepAliveMs: 50 },
  );

  const events = await chat({ message: "what's downloading?" });

  const queueProgress = events.filter((e) => e.event === "progress" && e.data.label === "Checking the download queue…");
  expect(queueProgress.length).toBeGreaterThanOrEqual(3);
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_2" } });
});

test("the tool-round cap stops a looping model", async () => {
  const { chat, openai } = setup(
    {
      openai: fakeOpenAI([toolCall("resp_loop", "get_queue")]),
      sonarr: { "GET /api/v3/queue": () => ({ records: [] }) },
      radarr: { "GET /api/v3/queue": () => ({ records: [] }) },
    },
    { maxToolRounds: 2 },
  );

  const events = await chat({ message: "loop forever" });

  expect(openai.calls).toHaveLength(3);
  expect(events.at(-1)).toEqual({
    event: "error",
    data: { message: "Stopped after 2 tool rounds without a final answer." },
  });
  expect(events.some((e) => e.event === "done")).toBe(false);
});

test("OpenAI overload is retried, then surfaces as an error", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([503, 503, 503]) });

  const events = await chat({ message: "hi" });

  expect(openai.calls).toHaveLength(3);
  expect(events).toEqual([
    { event: "error", data: { message: "OpenAI API error (HTTP 503): The server is overloaded" } },
  ]);
});

test("an overload that clears on retry still answers", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([503, reply("resp_1", "Back.")]) });

  const events = await chat({ message: "hi" });

  expect(openai.calls).toHaveLength(2);
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_1" } });
});
