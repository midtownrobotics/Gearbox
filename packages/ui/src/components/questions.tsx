import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field, inputClass } from "./field";
import { SuccessBanner } from "./messages";

type Question = { message: string; initial?: string; resolve: (value: string | null) => void };
type Questions = {
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, initial?: string) => Promise<string | null>;
  notify: (message: string) => void;
};
const QuestionsContext = createContext<Questions | null>(null);

/** In-page questions for workflows that need an answer before their next step. */
export function QuestionProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const pending = useRef<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!question) return;
    const active = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      (
        document.querySelector<HTMLElement>('[role="dialog"] input') ??
        document.querySelector<HTMLElement>('[role="dialog"] button')
      )?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      if (active instanceof HTMLElement && active.isConnected) active.focus();
    };
  }, [question]);
  function finish(value: string | null) {
    const current = pending.current;
    pending.current = null;
    setQuestion(null);
    current?.resolve(value);
  }
  const questions = useMemo<Questions>(() => {
    const ask = (message: string, initial?: string) => {
      // A repeated click must not replace an unanswered question.
      if (pending.current) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        const next = { message, initial, resolve };
        pending.current = next;
        setAnswer(initial ?? "");
        setQuestion(next);
      });
    };
    return {
      confirm: async (message) => (await ask(message)) !== null,
      prompt: (message, initial = "") => ask(message, initial),
      notify: setNotice,
    };
  }, []);
  useEffect(
    () => () => {
      pending.current?.resolve(null);
      pending.current = null;
    },
    [],
  );
  return (
    <QuestionsContext.Provider value={questions}>
      {children}
      {notice && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md space-y-2" role="status">
          <SuccessBanner message={notice} />
          <Button variant="secondary" size="sm" onClick={() => setNotice("")}>
            Dismiss
          </Button>
        </div>
      )}
      {question && (
        <Dialog
          title={question.initial === undefined ? "Confirm action" : "Enter details"}
          onClose={() => finish(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              finish(question.initial === undefined ? "yes" : answer.trim());
            }}
          >
            {question.initial === undefined ? (
              <p className="text-sm text-secondary-700">{question.message}</p>
            ) : (
              <Field label={question.message}>
                <input
                  className={inputClass}
                  required
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={question.initial !== undefined && !answer.trim()}
                variant={/delete|permanent|remove/i.test(question.message) ? "danger" : "primary"}
              >
                {question.initial !== undefined
                  ? "Continue"
                  : /delete|permanent/i.test(question.message)
                    ? "Delete"
                    : /remove/i.test(question.message)
                      ? "Remove"
                      : "Confirm"}
              </Button>
              <Button variant="secondary" type="button" onClick={() => finish(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </QuestionsContext.Provider>
  );
}

export function useQuestions(): Questions {
  const questions = useContext(QuestionsContext);
  if (!questions) throw new Error("useQuestions needs a QuestionProvider.");
  return questions;
}
