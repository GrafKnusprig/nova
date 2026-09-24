import { Fragment, useEffect, useRef, useState } from "react";

type Mode = "draft" | "edit" | "full";
type Provider = "openai" | "fhgenie";
type ConversationStyle = "default" | "professional";
type InteractionMode = "chat" | "note";
type EntryStatus = "queued" | "processing" | "complete";
export type AssistantQueueEntry = {
  id: string;
  requestId: string;
  role: "user" | "assistant";
  content: string;
  interactionMode: InteractionMode;
  conversationStyle: ConversationStyle;
  mode: Mode;
  status: EntryStatus;
};
type Approval = {
  id: string;
  requiredMode: "edit" | "full";
  reason: string;
  requestId: string;
  interactionMode: InteractionMode;
};
const FHGENIE_MODELS = [
  "nvidia/GLM-5.2-NVFP4",
  "deepseek-ai/DeepSeek-V4-Flash-0731",
  "openGPT-X/Teuken-7B-instruct-v0.6",
  "MiniMaxAI/MiniMax-M2.5",
  "Qwen/Qwen3-Coder-Next-FP8",
];
const modeHelp: Record<Mode, string> = {
  draft: "Chat and plan only. The project cannot be changed.",
  edit: "May create and edit nodes and links, but cannot delete.",
  full: "May create, edit, link, and permanently delete nodes.",
};
let nextEntryId = 0;
function entryId(): string {
  nextEntryId += 1;
  return `assistant-entry-${nextEntryId}`;
}
export function insertAssistantReply(
  entries: AssistantQueueEntry[],
  requestId: string,
  content: string,
  interactionMode: InteractionMode,
  mode: Mode,
  conversationStyle: ConversationStyle,
): AssistantQueueEntry[] {
  const next = entries.map((entry) =>
    entry.requestId === requestId && entry.role === "user"
      ? { ...entry, status: "complete" as const }
      : entry,
  );
  let index = next.length - 1;
  while (index >= 0 && next[index].requestId !== requestId) index -= 1;
  while (index + 1 < next.length && next[index + 1].requestId === requestId)
    index += 1;
  next.splice(index + 1, 0, {
    id: entryId(),
    requestId,
    role: "assistant",
    content,
    interactionMode,
    conversationStyle,
    mode,
    status: "complete",
  });
  return next;
}

export function AssistantPanel() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Mode>("draft");
  const [conversationStyle, setConversationStyle] =
    useState<ConversationStyle>("default");
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("chat");
  const [entries, setEntries] = useState<AssistantQueueEntry[]>([]);
  const [input, setInput] = useState("");
  const [approval, setApproval] = useState<Approval>();
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [resolvingApproval, setResolvingApproval] = useState(false);
  const [queuePulse, setQueuePulse] = useState(0);
  const [error, setError] = useState("");
  const processing = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const providerName = provider === "fhgenie" ? "FhGenie" : "OpenAI";
  const availableModels = [
    ...new Set([...(provider === "fhgenie" ? FHGENIE_MODELS : []), ...models]),
  ];
  const requestRunning = entries.some((entry) => entry.status === "processing");

  useEffect(() => {
    void window.mindmap.assistant
      .status()
      .then((status) => {
        setProvider(status.provider);
        setHasKey(status.hasKey);
        setModel(status.model);
      })
      .catch((reason) => setError(String(reason)));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries, approval, resolvingApproval]);
  useEffect(() => {
    if (processing.current || approval || resolvingApproval) return;
    const next = entries.find(
      (entry) => entry.role === "user" && entry.status === "queued",
    );
    if (!next) return;
    processing.current = true;
    setEntries((current) =>
      current.map((entry) =>
        entry.id === next.id ? { ...entry, status: "processing" } : entry,
      ),
    );
    const outgoing = entries
      .filter((entry) => entry.status === "complete" || entry.id === next.id)
      .map(({ role, content }) => ({ role, content }));
    void window.mindmap.assistant
      .chat(outgoing, next.mode, next.interactionMode, next.conversationStyle)
      .then((reply) => {
        setEntries((current) =>
          insertAssistantReply(
            current,
            next.requestId,
            reply.text,
            next.interactionMode,
            next.mode,
            next.conversationStyle,
          ),
        );
        if (reply.approval)
          setApproval({
            ...reply.approval,
            requestId: next.requestId,
            interactionMode: next.interactionMode,
          });
      })
      .catch((reason) => {
        setError(String(reason));
        setEntries((current) =>
          current.map((entry) =>
            entry.id === next.id ? { ...entry, status: "complete" } : entry,
          ),
        );
      })
      .finally(() => {
        processing.current = false;
        setQueuePulse((value) => value + 1);
      });
  }, [entries, approval, resolvingApproval, queuePulse]);

  const refreshModels = async () => {
    setSettingsBusy(true);
    setError("");
    try {
      setModels(await window.mindmap.assistant.models(provider));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSettingsBusy(false);
    }
  };
  const chooseProvider = async (value: Provider) => {
    setSettingsBusy(true);
    setError("");
    try {
      const status = await window.mindmap.assistant.setProvider(value);
      setProvider(status.provider);
      setHasKey(status.hasKey);
      setModel(status.model);
      setModels([]);
      setApiKey("");
      setApproval(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSettingsBusy(false);
    }
  };
  const saveKey = async () => {
    setSettingsBusy(true);
    setError("");
    try {
      const status = await window.mindmap.assistant.saveKey(provider, apiKey);
      setApiKey("");
      setHasKey(status.hasKey);
      setModels(await window.mindmap.assistant.models(provider));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSettingsBusy(false);
    }
  };
  const deleteKey = async () => {
    if (
      !confirm(
        `Delete the securely stored ${providerName} API key from this computer?`,
      )
    )
      return;
    setSettingsBusy(true);
    setError("");
    try {
      const status = await window.mindmap.assistant.deleteKey(provider);
      setHasKey(status.hasKey);
      setModels([]);
      setApproval(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSettingsBusy(false);
    }
  };
  const chooseModel = async (value: string) => {
    setModel(value);
    setError("");
    try {
      await window.mindmap.assistant.setModel(provider, value);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const newChat = async () => {
    if (requestRunning || resolvingApproval) return;
    if (
      (entries.length > 0 || input.trim()) &&
      !confirm("Delete the current chat and start with a fresh context?")
    )
      return;
    setError("");
    try {
      await window.mindmap.assistant.newChat();
      setEntries([]);
      setInput("");
      setApproval(undefined);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (!hasKey) {
      setError(`Save a ${providerName} API key before sending.`);
      return;
    }
    if (!model) {
      setError("Choose a model before sending.");
      return;
    }
    const id = entryId();
    setEntries((current) => [
      ...current,
      {
        id,
        requestId: id,
        role: "user",
        content: text,
        interactionMode,
        conversationStyle,
        mode,
        status: "queued",
      },
    ]);
    setInput("");
    setError("");
  };
  const discardQueued = (id: string) =>
    setEntries((current) =>
      current.filter((entry) => entry.id !== id || entry.status !== "queued"),
    );
  const resolveApproval = async (accepted: boolean) => {
    if (!approval || resolvingApproval) return;
    const pending = approval;
    setResolvingApproval(true);
    setError("");
    try {
      const reply = await window.mindmap.assistant.resolveApproval(
        pending.id,
        accepted,
      );
      const source = entries.find(
        (entry) => entry.requestId === pending.requestId,
      )!;
      setEntries((current) =>
        insertAssistantReply(
          current,
          pending.requestId,
          reply.text,
          pending.interactionMode,
          source.mode,
          source.conversationStyle,
        ),
      );
      setApproval(
        reply.approval
          ? {
              ...reply.approval,
              requestId: pending.requestId,
              interactionMode: pending.interactionMode,
            }
          : undefined,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setResolvingApproval(false);
      setQueuePulse((value) => value + 1);
    }
  };

  return (
    <section
      className={`assistant-panel ${interactionMode === "note" ? "note-mode" : "chat-mode"}`}
    >
      <header>
        <div>
          <p className="eyebrow">AI ASSISTANT</p>
          <strong>{providerName} · project scoped</strong>
        </div>
        <div className="assistant-header-actions">
          <button
            onClick={() => void newChat()}
            disabled={requestRunning || resolvingApproval}
          >
            New chat
          </button>
          <div className={`assistant-connection ${hasKey ? "ready" : ""}`}>
            {hasKey ? "Key saved" : "No API key"}
          </div>
        </div>
      </header>
      <details className="assistant-settings">
        <summary>
          <span>Connection &amp; response settings</span>
          <span>
            {providerName} · {model || "no model"} · {conversationStyle}
          </span>
        </summary>
        <div className="assistant-settings-body">
          <div className="assistant-model-row">
            <label>
              Provider
              <select
                value={provider}
                disabled={settingsBusy || requestRunning || Boolean(approval)}
                onChange={(event) =>
                  void chooseProvider(event.target.value as Provider)
                }
              >
                <option value="openai">OpenAI</option>
                <option value="fhgenie">FhGenie</option>
              </select>
            </label>
          </div>
          {!hasKey ? (
            <div className="assistant-key-row">
              <input
                type="password"
                autoComplete="off"
                placeholder={`${providerName} API key`}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                onClick={() => void saveKey()}
                disabled={settingsBusy || !apiKey.trim()}
              >
                Save securely
              </button>
            </div>
          ) : (
            <div className="assistant-key-row">
              <span>
                The {providerName} key is encrypted with the operating-system
                credential service.
              </span>
              <button
                className="danger"
                onClick={() => void deleteKey()}
                disabled={settingsBusy || requestRunning}
              >
                Delete API key
              </button>
            </div>
          )}
          <div className="assistant-model-row">
            <label>
              Model
              <select
                value={model}
                disabled={!hasKey || settingsBusy || requestRunning}
                onChange={(event) => void chooseModel(event.target.value)}
              >
                <option value="">Choose a model</option>
                {model && !availableModels.includes(model) && (
                  <option value={model}>{model}</option>
                )}
                {availableModels.map((entry) => (
                  <option value={entry} key={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void refreshModels()}
              disabled={!hasKey || settingsBusy || requestRunning}
            >
              Refresh models
            </button>
          </div>
          <div>
            <p className="assistant-setting-label">Chat response style</p>
            <div
              className="assistant-choice"
              role="group"
              aria-label="Chat response style"
            >
              {(["default", "professional"] as ConversationStyle[]).map(
                (entry) => (
                  <button
                    key={entry}
                    className={conversationStyle === entry ? "active" : ""}
                    disabled={Boolean(approval)}
                    onClick={() => setConversationStyle(entry)}
                  >
                    {entry}
                  </button>
                ),
              )}
            </div>
            <p className="assistant-mode-help">
              {conversationStyle === "default"
                ? "Uses the model’s natural conversational style."
                : "Shorter, precise, and direct chat responses."}{" "}
              Node writing is always scientific and professional.
            </p>
          </div>
        </div>
      </details>
      <div className="assistant-primary-controls">
        <div>
          <p className="assistant-setting-label">Write permission</p>
          <div
            className="assistant-modes"
            role="group"
            aria-label="Assistant permission mode"
          >
            {(["draft", "edit", "full"] as Mode[]).map((entry) => (
              <button
                key={entry}
                className={mode === entry ? "active" : ""}
                disabled={Boolean(approval)}
                onClick={() => setMode(entry)}
                title={modeHelp[entry]}
              >
                {entry}
              </button>
            ))}
          </div>
          <p className="assistant-mode-help">{modeHelp[mode]}</p>
        </div>
        <div>
          <p className="assistant-setting-label">Input mode</p>
          <div
            className="assistant-choice assistant-input-modes"
            role="group"
            aria-label="Assistant input mode"
          >
            <button
              className={interactionMode === "chat" ? "active" : ""}
              disabled={Boolean(approval)}
              onClick={() => setInteractionMode("chat")}
            >
              Chat
            </button>
            <button
              className={interactionMode === "note" ? "active" : ""}
              disabled={Boolean(approval)}
              onClick={() => setInteractionMode("note")}
            >
              Add note
            </button>
          </div>
        </div>
      </div>
      <div className="assistant-chat">
        {entries.length === 0 && (
          <div className="assistant-empty">
            <strong>Work with the current knowledge map</strong>
            <p>
              The assistant follows the project’s AGENTS.md and can access only
              the currently open project file.
            </p>
          </div>
        )}
        {entries.map((entry, index) => {
          const lastForRequest =
            entries.findIndex(
              (later, laterIndex) =>
                laterIndex > index && later.requestId === entry.requestId,
            ) < 0;
          return (
            <Fragment key={entry.id}>
              <article
                className={`assistant-message ${entry.role} ${entry.interactionMode} ${entry.status}`}
              >
                <span>
                  {entry.role === "user"
                    ? `You · ${entry.interactionMode === "note" ? "Note" : "Chat"}`
                    : "Assistant"}
                </span>
                {entry.status === "queued" && (
                  <button
                    className="assistant-queue-remove"
                    title="Discard queued message"
                    aria-label="Discard queued message"
                    onClick={() => discardQueued(entry.id)}
                  >
                    ×
                  </button>
                )}
                <p>{entry.content}</p>
                {entry.role === "user" && (
                  <small className={`assistant-message-permission ${entry.mode}`}>
                    Write permission: {entry.mode}
                  </small>
                )}
              </article>
              {entry.status === "processing" && (
                <div className={`assistant-thinking ${entry.interactionMode}`}>
                  Working…
                </div>
              )}
              {approval?.requestId === entry.requestId && lastForRequest && (
                <aside
                  className={`assistant-approval ${approval.interactionMode}`}
                >
                  <strong>Permission required: {approval.requiredMode}</strong>
                  <p>{approval.reason}</p>
                  <div>
                    <button
                      onClick={() => void resolveApproval(false)}
                      disabled={resolvingApproval}
                    >
                      Decline
                    </button>
                    <button
                      className="primary"
                      onClick={() => void resolveApproval(true)}
                      disabled={resolvingApproval}
                    >
                      Accept once
                    </button>
                  </div>
                </aside>
              )}
            </Fragment>
          );
        })}
        <div ref={end} />
      </div>
      {error && <div className="assistant-error">{error}</div>}
      <footer>
        <textarea
          placeholder={
            !hasKey
              ? "Write here, then configure an API key in settings…"
              : !model
                ? "Write here, then choose a model in settings…"
                : interactionMode === "note"
                  ? mode === "draft"
                    ? "Add knowledge to preview how it would be integrated…"
                    : "Add knowledge for NOVA to integrate into the map…"
                  : "Ask about or work on the current project…"
          }
          value={input}
          disabled={Boolean(approval)}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="primary"
          onClick={submit}
          disabled={!hasKey || !model || !input.trim() || Boolean(approval)}
        >
          {interactionMode === "note"
            ? "Add note"
            : requestRunning
              ? "Queue chat"
              : "Send"}
        </button>
      </footer>
    </section>
  );
}
