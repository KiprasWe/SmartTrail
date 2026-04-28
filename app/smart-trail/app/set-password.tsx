import { useState } from "react";
import { useRouter } from "expo-router";
import { useProfileStore } from "@/store/use-profile-store";
import { useTranslation } from "@/hooks/use-translation";
import {
  PasswordForm,
  validatePassword,
  useSavingState,
} from "@/components/auth/password-form";

export default function SetPasswordScreen() {
  const router = useRouter();
  const { setPassword } = useProfileStore();
  const { t } = useTranslation();

  const [password, setPasswordVal] = useState("");
  const [confirm, setConfirm] = useState("");
  const { saving, setSaving, error, setError } = useSavingState();

  const handleSave = async () => {
    setError(null);
    const validationError = validatePassword(
      password,
      confirm,
      t,
      "set-password",
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      await setPassword(password);
      router.back();
    } catch (err: any) {
      setError(
        err.response?.data?.error ??
          err.message ??
          t("set-password.error-generic"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PasswordForm
      title={t("set-password.title")}
      description={t("set-password.description")}
      fields={[
        {
          key: "password",
          label: t("set-password.new-label"),
          placeholder: t("set-password.new-placeholder"),
          value: password,
          onChange: setPasswordVal,
        },
        {
          key: "confirm",
          label: t("set-password.confirm-label"),
          placeholder: t("set-password.confirm-placeholder"),
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
