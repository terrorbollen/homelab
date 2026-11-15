// OpenAI Responses API client and the agent loop. Types cover only what we use.
import type { Config } from "./server.ts";

export type FunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

type FunctionCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type OutputItem = FunctionCall | { type: "message" | "web_search_call" | "reasoning" };
type InputItem =
  | { role: "user"; content: string }
  | { type: "function_call_output"; call_id: string; output: string };

type Response = {
  id: string;
  status: string;
  output: OutputItem[];
  error?: { message: string } | null;
  incomplete_details?: { reason: string } | null;
};

type StreamEvent =
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.output_item.added"; item: OutputItem }
  | { type: "response.completed" | "response.failed" | "response.incomplete"; response: Response }
  | { type: "error"; message: string; code: string | null };

export type Emit = (event: "text" | "progress" | "done" | "error", data: Record<string, string>) => void;
export type RunTool = (name: string, args: any, progress: (label: string) => void) => Promise<unknown>;

export class UserFacingError extends Error {}

// Spend and quota errors are also 429s, but retrying them can't help.
const NO_RETRY_CODES = ["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"];

async function post(cfg: Config, body: unknown): Promise<globalThis.Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.openai.url}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.openai.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    const text = await res.text();
    const retryable = [429, 500, 502, 503, 504].includes(res.status) && !NO_RETRY_CODES.some((c) => text.includes(c));
    if (!retryable || attempt >= cfg.retryDelaysMs.length) {
      console.error(`openai: HTTP ${res.status}: ${text}`);
      let message = text;
      try { message = JSON.parse(text).error?.message ?? text; } catch {}
      throw new UserFacingError(`OpenAI API error (HTTP ${res.status}): ${message}`);
    }
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    await Bun.sleep(retryAfter || cfg.retryDelaysMs[attempt]!);
  }
}

async function* events(res: globalThis.Response): AsyncGenerator<StreamEvent> {
  let buffer = "";
  for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  }
}

async function stream(cfg: Config, body: Record<string, unknown>, onText: (delta: string) => void, emit: Emit): Promise<Response> {
  const res = await post(cfg, { ...body, stream: true });
  for await (const event of events(res)) {
    switch (event.type) {
      case "response.output_text.delta":
        onText(event.delta);
        break;
      case "response.output_item.added":
        if (event.item.type === "web_search_call") emit("progress", { label: "Searching the web…" });
        break;
      case "response.completed":
        return event.response;
      case "response.failed":
      case "response.incomplete":
        throw new UserFacingError(`OpenAI response ${event.response.status}: ${event.response.error?.message ?? event.response.incomplete_details?.reason ?? "unknown reason"}`);
      case "error":
        throw new UserFacingError(`OpenAI error: ${event.message}`);
    }
  }
  throw new UserFacingError("OpenAI stream ended before the response completed");
}

export async function runTurn(cfg: Config, tools: FunctionTool[], runTool: RunTool, message: string, previousResponseId: string | undefined, emit: Emit) {
  let input: InputItem[] = [{ role: "user", content: message }];
  let previous = previousResponseId;
  let wroteText = false;
  let roundText = false;
  const onText = (delta: string) => {
    // Separate text from different rounds so it doesn't run together.
    emit("text", { delta: wroteText && !roundText ? `\n\n${delta}` : delta });
    wroteText = roundText = true;
  };

  for (let round = 0; round <= cfg.maxToolRounds; round++) {
    roundText = false;
    const response = await stream(cfg, {
      model: cfg.openai.model,
      reasoning: { effort: cfg.openai.reasoningEffort },
      // Instructions don't carry over with previous_response_id, so they go on every request.
      instructions: cfg.prompt,
      tools: [...tools, { type: "web_search" }],
      input,
      ...(previous && { previous_response_id: previous }),
    }, onText, emit);

    const calls = response.output.filter((item): item is FunctionCall => item.type === "function_call");
    if (!calls.length) {
      emit("done", { responseId: response.id });
      return;
    }
    if (round === cfg.maxToolRounds) break;

    input = [];
    for (const call of calls) {
      let output: unknown;
      try {
        output = await runTool(call.name, JSON.parse(call.arguments), (label) => emit("progress", { label }));
      } catch (e) {
        // The model gets the error so it can tell the user which app failed.
        console.error(`tool ${call.name} failed:`, e);
        output = { error: e instanceof Error ? e.message : String(e) };
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output: typeof output === "string" ? output : JSON.stringify(output) });
    }
    previous = response.id;
  }
  throw new UserFacingError(`Stopped after ${cfg.maxToolRounds} tool rounds without a final answer.`);
}
