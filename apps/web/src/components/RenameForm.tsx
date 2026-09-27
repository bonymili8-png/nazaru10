"use client";
import { LATIN_NAME } from "@thoroughline/contracts";
import { Gem } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { invalidate } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";
import { Button, Card, useToast } from "./ui";

/** Paid rename (gems): Latin-only name with live validation. The server re-checks everything. */
export function RenameForm({
  title,
  current,
  maxLength,
  priceGems,
  endpoint,
  refresh,
  onClose,
}: {
  title: string;
  current: string;
  maxLength: number;
  priceGems: number;
  endpoint: string;
  refresh: string[];
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const name = value.trim().replace(/\s+/g, " ");
  const problem =
    name.length > 0 && !LATIN_NAME.test(name)
      ? t("rename.notLatin")
      : name.length < 2
        ? t("rename.tooShort")
        : null;
  const valid = !problem && name !== current;

  const submit = async () => {
    if (!valid || !window.confirm(t("rename.confirm", { name, n: priceGems }))) return;
    setBusy(true);
    try {
      await post(endpoint, { name });
      haptic.success();
      toast(t("rename.done", { name }));
      invalidate(...refresh, "/wallet");
      onClose();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3">
      <p className="font-semibold">{title}</p>
      <label htmlFor="rename" className="mt-2 block text-sm text-muted">
        {t("rename.label")}
      </label>
      <input
        id="rename"
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={!!problem}
        aria-describedby="rename-help"
        className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
      />
      <p
        id="rename-help"
        className={`mt-1 text-xs ${problem ? "text-bad" : "text-muted"}`}
        role={problem ? "alert" : undefined}
      >
        {problem ?? t("rename.hint", { n: maxLength })}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t("rename.cancel")}
        </Button>
        <Button onClick={submit} disabled={!valid} loading={busy}>
          <Gem className="size-4" aria-hidden />
          {t("rename.submit", { n: priceGems })}
        </Button>
      </div>
    </Card>
  );
}
