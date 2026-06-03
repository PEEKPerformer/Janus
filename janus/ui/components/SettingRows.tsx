import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

/**
 * Small, reusable setting controls used across the Settings sections. Kept
 * presentational (value + onChange) so they're trivially testable and reused by
 * every preference row regardless of which source(s) the preference governs.
 */

function Hint({ text }: { text?: string }) {
  const t = useTheme();
  if (!text) return null;
  return (
    <Text
      style={[t.type.small, { color: t.colors.textTertiary, marginTop: 2 }]}
    >
      {text}
    </Text>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: t.colors.border, backgroundColor: t.colors.card },
      ]}
    >
      <View style={styles.rowText}>
        <Text style={[t.type.body, { color: t.colors.text }]}>{label}</Text>
        <Hint text={hint} />
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: t.colors.accentActive, false: t.colors.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
}

export function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.colRow,
        { borderBottomColor: t.colors.border, backgroundColor: t.colors.card },
      ]}
    >
      <Text style={[t.type.body, { color: t.colors.text }]}>{label}</Text>
      <Hint text={hint} />
      <View style={styles.chips}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => onChange(o.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${o.label}`}
              style={[
                styles.chip,
                { borderRadius: t.radius.pill, borderColor: t.colors.border },
                active
                  ? {
                      backgroundColor: t.colors.accentActive,
                      borderColor: t.colors.accentActive,
                    }
                  : { backgroundColor: t.colors.bgElevated },
              ]}
            >
              <Text
                style={[
                  t.type.small,
                  {
                    color: active ? "#fff" : t.colors.textSecondary,
                    fontWeight: active ? "700" : "500",
                  },
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function StepperRow({
  label,
  hint,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const t = useTheme();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const round = (n: number) => Math.round(n * 100) / 100;
  const btn = (delta: number, icon: "remove" | "add", a11y: string) => {
    const disabled = (delta < 0 && value <= min) || (delta > 0 && value >= max);
    return (
      <Pressable
        onPress={() => onChange(round(clamp(value + delta)))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        hitSlop={8}
        style={[
          styles.stepBtn,
          {
            borderColor: t.colors.border,
            opacity: disabled ? 0.35 : 1,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={t.colors.text} />
      </Pressable>
    );
  };
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: t.colors.border, backgroundColor: t.colors.card },
      ]}
    >
      <View style={styles.rowText}>
        <Text style={[t.type.body, { color: t.colors.text }]}>{label}</Text>
        <Hint text={hint} />
      </View>
      <View style={styles.stepper}>
        {btn(-step, "remove", `Decrease ${label}`)}
        <Text
          style={[
            t.type.meta,
            { color: t.colors.text, minWidth: 44, textAlign: "center" },
          ]}
        >
          {display}
        </Text>
        {btn(step, "add", `Increase ${label}`)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, marginRight: 12 },
  colRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
