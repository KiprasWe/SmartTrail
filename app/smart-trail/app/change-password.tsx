import { useState } from "react";
import { useRouter } from "expo-router";
import { useProfileStore } from "@/store/use-profile-store";
import { resolveErr } from "@/lib/error-messages";
import { t } from "@/lib/i18n";
import {
  PasswordForm,
  validatePassword,
  useSavingState,
} from "@/components/auth/password-form";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { changePassword } = useProfileStore();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { saving, setSaving, error, setError } = useSavingState();

  const handleSave = async () => {
    setError(null);
    if (!current) {
      setError(t("change-password.error-current-empty"));
      return;
    }
    const validationError = validatePassword(
      next,
      confirm,
      t,
      "change-password",
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      await changePassword(current, next);
      router.back();
    } catch (err: unknown) {
      setError(resolveErr(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PasswordForm
      title={t("change-password.title")}
      fields={[
        {
          key: "current",
          label: t("change-password.current-label"),
          placeholder: t("change-password.current-placeholder"),
          value: current,
          onChange: setCurrent,
        },
        {
          key: "next",
          label: t("change-password.new-label"),
          placeholder: t("change-password.new-placeholder"),
          value: next,
          onChange: setNext,
        },
        {
          key: "confirm",
          label: t("change-password.confirm-label"),
          placeholder: t("change-password.confirm-placeholder"),
          value: confirm,
          onChange: setConfirm,
        },
      ]}
      error={error}
      saving={saving}
      onSave={handleSave}
    />
  );
}
