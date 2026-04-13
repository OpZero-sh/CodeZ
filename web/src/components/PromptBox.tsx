import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

import { Loader2, Mic, Send, Square, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { store, useStore } from "@/lib/store";
import { api } from "@/lib/api";
import QuickActions from "./QuickActions";
import SlashCommandPicker from "./SlashCommandPicker";

const BUILTIN_SLASH_COMMANDS = [
  "/update-config", "/debug", "/simplify", "/batch", "/loop", "/schedule",
  "/claude-api", "/deploy-to-vercel", "/wrangler", "/cloudflare",
  "/brainstorming", "/orchestrate", "/dogfood", "/find-skills",
  "/compact", "/context", "/cost", "/heapdump", "/init",
  "/review", "/security-review", "/insights", "/team-onboarding",
];

function PromptBox() {
  const state = useStore();
  const sessionId = state.selected.sessionId;
  const sending = sessionId ? !!state.sending[sessionId] : false;
  const [value, setValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ fileId: string; path: string; name: string }>>([]);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const SpeechRecognitionAPI = (typeof window !== "undefined" &&
    window.SpeechRecognition ||
    window.webkitSpeechRecognition) as
    | SpeechRecognitionConstructor
    | undefined;
  const voiceAvailable = !!SpeechRecognitionAPI;

  async function startVoice() {
    if (!SpeechRecognitionAPI || !sessionId) return;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setValue((prev) => prev + transcript);
    };

    recognition.onend = () => {
      setListening(false);
      const text = valueRef.current.trim();
      if (text && sessionId) {
        store.sendPrompt(text).then(() => {
          setValue("");
          setSendError(null);
        });
      }
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const currentSession = sessionId
    ? state.sessionsByProject[state.selected.slug ?? ""]?.find((s) => s.id === sessionId)
    : null;

  const slashCommands = useMemo(() => {
    const fromMeta = currentSession?.metadata?.slashCommands;
    if (fromMeta && fromMeta.length > 0) {
      return fromMeta.map((c) => (c.startsWith("/") ? c : `/${c}`));
    }
    return BUILTIN_SLASH_COMMANDS;
  }, [currentSession]);

  const pickerOpen = value.startsWith("/");

  const filteredForKeys = useMemo(() => {
    if (!pickerOpen) return [];
    const needle = value.slice(1).toLowerCase().trim();
    const unique = Array.from(new Set(slashCommands));
    if (!needle) return unique;
    return unique.filter((c) => c.slice(1).toLowerCase().includes(needle));
  }, [pickerOpen, value, slashCommands]);

  useEffect(() => {
    setValue("");
    setSendError(null);
    setAttachments([]);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    setPickerIndex(0);
  }, [value.startsWith("/") ? value.split(" ")[0] : ""]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(300, el.scrollHeight);
    el.style.height = `${h}px`;
  }, [value]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && sending) {
        store.abortCurrent();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending]);

  async function submit() {
    if (!sessionId) return;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    try {
      await store.sendPrompt(text, attachments.map(a => ({ fileId: a.fileId, path: a.path })));
      setValue("");
      setAttachments([]);
      setSendError(null);
    } catch (err) {
      setSendError((err as Error).message);
    }
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !sessionId) return;
    for (const file of files) {
      try {
        const result = await api.uploadFile(sessionId, file);
        setAttachments(prev => [...prev, { ...result, name: file.name }]);
      } catch (err) {
        setSendError((err as Error).message);
      }
    }
    e.target.value = "";
  }

  function removeAttachment(fileId: string) {
    setAttachments(prev => prev.filter(a => a.fileId !== fileId));
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!sessionId) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const result = await api.uploadFile(sessionId, file);
          setAttachments(prev => [...prev, { ...result, name: file.name }]);
        } catch (err) {
          setSendError((err as Error).message);
        }
        return;
      }
    }
  }

  function insertText(text: string) {
    setValue((prev) => {
      if (!prev) return text;
      const needsSpace = !prev.endsWith(" ") && !prev.endsWith("\n");
      return `${prev}${needsSpace ? " " : ""}${text}`;
    });
    requestAnimationFrame(() => {
      ref.current?.focus();
    });
  }

  function pickCommand(cmd: string) {
    setValue(`${cmd} `);
    setPickerIndex(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
    });
  }

  function dismissPicker() {
    setValue("");
    setPickerIndex(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && filteredForKeys.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => (i + 1) % filteredForKeys.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => (i - 1 + filteredForKeys.length) % filteredForKeys.length);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredForKeys[pickerIndex];
        if (cmd) pickCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissPicker();
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (sending) {
        store.abortCurrent();
      } else {
        void submit();
      }
    }
  }

  const status = currentSession?.status;
  const channelPresent = !!currentSession?.channel?.present;
  const disabled = !sessionId;
  const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0) && !sending;

  return (
    <div
      className="shrink-0 border-t border-border/40 glass"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)",
      }}
    >
      <div className="max-w-4xl mx-auto w-full px-3 pt-2">
        {sending && (
          <div className="flex items-center justify-end gap-1 text-[10px] text-primary px-1 pb-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            streaming — Esc to stop
          </div>
        )}
        <QuickActions disabled={disabled} onInsert={insertText} />
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*"
          multiple
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-2">
            {attachments.map((att) => (
              <div
                key={att.fileId}
                className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
              >
                <span className="truncate max-w-[100px]">{att.name}</span>
                <button
                  onClick={() => removeAttachment(att.fileId)}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          {pickerOpen && (
            <SlashCommandPicker
              query={value}
              commands={slashCommands}
              selectedIndex={pickerIndex}
              onSelectedIndexChange={setPickerIndex}
              onPick={pickCommand}
              onDismiss={dismissPicker}
              anchorRef={ref}
            />
          )}
          <div
            className={cn(
              "flex items-end gap-2 rounded-lg border border-border bg-background/60 p-2 transition-colors",
              !disabled && "focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30",
            )}
          >
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (sendError) setSendError(null);
              }}
              onKeyDown={onKeyDown}
              onPaste={handlePaste}
              disabled={disabled}
              placeholder={
                !sessionId
                  ? "Select a session to start chatting"
                  : status === "mirror" && channelPresent
                    ? "Ask Claude (via channel)..."
                    : status === "mirror"
                      ? "Ask Claude (mirror session)..."
                      : "Ask Claude anything..."
              }
              rows={2}
              className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed placeholder:text-muted-foreground/60 disabled:opacity-50 min-h-[48px] max-h-[240px]"
            />
            {sending ? (
              <Button
                size="icon"
                variant="destructive"
                onClick={() => store.abortCurrent()}
                aria-label="Stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  aria-label="Attach file"
                  className="text-muted-foreground hover:text-primary"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                {voiceAvailable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={listening ? stopVoice : startVoice}
                    disabled={disabled}
                    aria-label={listening ? "Stop listening" : "Start voice input"}
                    className={listening ? "text-destructive" : "text-muted-foreground hover:text-primary"}
                  >
                    <Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
                  </Button>
                )}
                <Button
                  size="icon"
                  disabled={!canSend}
                  onClick={() => {
                    void submit();
                  }}
                  aria-label="Send"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          {sendError && (
            <div className="px-1 pt-2 text-xs text-destructive">
              {sendError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PromptBox;
