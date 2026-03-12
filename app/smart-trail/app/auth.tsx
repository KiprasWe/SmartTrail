import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useAuth } from "@/context/auth-context";

export default function AuthScreen() {
  const { signin, signinWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoad, setGoogleLoad] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await signin(email, password);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoad(true);
    try {
      await signinWithGoogle();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Google sign-in failed");
    } finally {
      setGoogleLoad(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAwareScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-bold text-stone-900 mb-1">Sign in</Text>
        <Text className="text-stone-500 text-sm mb-8">Welcome back</Text>

        <TouchableOpacity
          onPress={handleGoogle}
          disabled={googleLoad}
          className="flex-row items-center justify-center gap-2 border border-stone-200 rounded-xl py-3.5 mb-4"
        >
          {googleLoad ? (
            <ActivityIndicator color="#1c1917" size="small" />
          ) : (
            <>
              <Text className="text-base font-extrabold text-stone-900">G</Text>
              <Text className="text-sm font-semibold text-stone-900">
                Continue with Google
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View className="flex-row items-center gap-3 mb-4">
          <View className="flex-1 h-px bg-stone-200" />
          <Text className="text-stone-400 text-xs">or</Text>
          <View className="flex-1 h-px bg-stone-200" />
        </View>

        <View className="gap-3 mb-6">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#a8a29e"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-stone-200 rounded-xl px-4 py-3.5 text-stone-900 text-base"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#a8a29e"
            secureTextEntry
            className="border border-stone-200 rounded-xl px-4 py-3.5 text-stone-900 text-base"
          />
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 16 }}>
        <View className="px-6 pb-4">
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            className={`rounded-xl py-4 items-center ${submitting ? "bg-stone-300" : "bg-stone-900"}`}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-semibold text-base">
                Sign In
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}
