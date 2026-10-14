"use client";

import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from "@olaxbonnke/natlas-js";

export default function LanguageSelect<T extends string>({
  value,
  onChange,
  label,
  extra,
  id,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  label: string;
  extra?: { value: T; label: string };
  id: string;
  className?: string;
}) {
  return (
    <label htmlFor={id} className={`flex min-w-0 items-center gap-2 text-[13px] ${className}`}>
      <span className="text-subtle shrink-0 font-medium">{label}</span>
      <select id={id} className="select min-w-0 max-w-full flex-1 truncate" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {extra ? <option value={extra.value}>{extra.label}</option> : null}
        {LANGUAGE_CODES.map((code: LanguageCode) => (
          <option key={code} value={code}>
            {LANGUAGES[code].name}
            {code !== "en" ? ` · ${LANGUAGES[code].nativeName}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
