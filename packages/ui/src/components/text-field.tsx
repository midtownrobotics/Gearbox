import { type SafeTextKind, nextSafe } from "@g3/demo";
import { isDemoPage } from "@g3/site-config";
import {
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { inputClass } from "./field";
import { focusRing } from "./focus";

/**
 * How a text field looks: `default` for a form, `compact` for a table cell or a row of controls,
 * `inline` for a title edited where it's shown, `search` for a search box, `plain` for none of
 * these (the caller's `className` is all of it: Scouting's own CSS).
 */
export type TextFieldVariant = "default" | "compact" | "inline" | "search" | "plain";

const VARIANTS: Record<TextFieldVariant, string> = {
  default: inputClass,
  compact:
    "rounded-md border border-secondary-300 bg-surface px-2 py-1 text-sm text-secondary-900 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30",
  inline:
    "rounded border border-transparent bg-transparent px-1 py-0.5 text-secondary-900 hover:border-secondary-300 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30",
  search: inputClass,
  plain: "",
};

type Shared = {
  variant?: TextFieldVariant;
  /**
   * What the text is. In the public demo, nothing is typed: the field offers text of this kind
   * to pick with its rotate button, so nothing a visitor writes leaves their computer.
   */
  kind?: SafeTextKind;
  /**
   * Stays typeable in the demo, for text that never leaves the page (a box that filters what's
   * shown) or has no words in it (a price, a number, a color). The gateway still refuses words
   * the demo doesn't have.
   */
  typeable?: boolean;
};

type InputProps = Shared &
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
    multiline?: false;
    type?: "text" | "search" | "url" | "email" | "tel";
    ref?: Ref<HTMLInputElement>;
  };

type AreaProps = Shared &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    multiline: true;
    ref?: Ref<HTMLTextAreaElement>;
  };

/** Sets a field's value the way typing does, so its own onChange runs. */
function setLikeTyping(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * Every app's one text field: an input, or a textarea with `multiline`. It takes the same props
 * as the element it renders. Use it for any text a page sends; number, date and other inputs
 * aren't text and stay as they are.
 *
 * On the public demo's pages it can't be typed in: it shows its value with a button that picks
 * another of `kind`'s safe texts (a required field starts with one). A search box stays typeable,
 * since what's typed in one only filters the page, and so does a `typeable` field.
 */
export function TextField(props: InputProps | AreaProps) {
  const {
    variant = "default",
    kind = "text",
    typeable = false,
    className = "",
    ref,
    multiline,
    ...rest
  } = props;
  const own = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const isSearch =
    variant === "search" || (!multiline && (rest as { type?: string }).type === "search");
  const picking = isDemoPage && !isSearch && !typeable && !props.disabled;

  const setRef = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      own.current = el;
      assignRef(ref as Ref<HTMLInputElement | HTMLTextAreaElement> | undefined, el);
    },
    [ref],
  );

  const rotate = useCallback(() => {
    const el = own.current;
    if (el) setLikeTyping(el, nextSafe(kind, el.value));
  }, [kind]);

  // A required field starts with something to send.
  useEffect(() => {
    if (picking && props.required && own.current && own.current.value === "") rotate();
  }, [picking, props.required, rotate]);

  const classes = `${VARIANTS[variant]} ${picking ? "cursor-default pr-9" : ""} ${className}`;
  const field = multiline ? (
    <textarea
      {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      ref={setRef}
      readOnly={picking || props.readOnly}
      className={classes}
    />
  ) : (
    <input
      type={isSearch ? "search" : "text"}
      {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      ref={setRef}
      readOnly={picking || props.readOnly}
      className={classes}
    />
  );
  if (!picking) return field;

  const wide = variant === "default" || multiline;
  return (
    <span className={`relative ${wide ? "block w-full" : "inline-flex"}`}>
      {field}
      <button
        type="button"
        title="Pick other text (the demo doesn't take typing)"
        aria-label="Pick other text"
        // Keep the field focused, so an edit that saves when it loses focus stays open.
        onMouseDown={(e) => e.preventDefault()}
        onClick={rotate}
        className={`absolute right-1.5 top-1.5 rounded-md p-1 text-secondary-500 hover:bg-secondary-100 hover:text-secondary-800 ${focusRing}`}
      >
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3.5h-3.5"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </span>
  );
}
