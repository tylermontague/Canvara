import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";
import { CanvaraMark } from "@/components/canvara-mark";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setError(null);
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.brandRow}>
          <CanvaraMark size={64} />
          <View>
            <Text style={styles.title}>CANVARA</Text>
            <Text style={styles.tagline}>FIELD</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>Sign in with your campaign account.</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[styles.button, pending && styles.buttonDisabled]}
          onPress={() => void handleSignIn()}
          disabled={pending || !email || !password}
        >
          <Text style={styles.buttonText}>{pending ? "Signing in…" : "Sign in"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: "center" },
  inner: { paddingHorizontal: 24, gap: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    fontFamily: fonts.display,
    letterSpacing: 5,
  },
  tagline: { color: colors.faint, fontSize: 12, letterSpacing: 6, marginTop: 2 },
  subtitle: { color: colors.dim, fontSize: 15, marginBottom: 12 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.red, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: "600" },
});
