"use client";

import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from "@olaxbonnke/natlas-js";

export default function LanguageSelect<T extends string>({
  value,
  onChange,
  label,
  extra,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  label: string;
  extra?: { value: T; label: string };
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-600">
      <span className="font-medium">{label}</span>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
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
