import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  Check,
  ChevronRight,
  Plus,
  Trophy,
  Zap,
  Timer,
  Settings2,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { Run } from "./core";
import {
  Progression,
  ExerciseId,
  WorkoutId,
  EXERCISES,
  WORKOUTS,
  activeSets,
  amountXP,
  dayAmount,
  levelInfo,
  localDay,
  dailyMissions,
  totalXP,
} from "./progression";
type Props = {
  progress: Progression;
  runs: Run[];
  owner: string;
  busy: boolean;
  compact?: boolean;
  onOpen?: () => void;
  onAdd: (id: WorkoutId, amount: number) => Promise<boolean>;
  onEdit: (id: string, amount: number | null) => Promise<boolean>;
  onGoal: (id: ExerciseId, target: number) => void;
};
export default function ProgressPanel({
  progress,
  runs,
  owner,
  busy,
  compact,
  onOpen,
  onAdd,
  onEdit,
  onGoal,
}: Props) {
  const [day, setDay] = useState(localDay()),
    [exercise, setExercise] = useState<WorkoutId>("pushups"),
    [amount, setAmount] = useState("5"),
    [editing, setEditing] = useState<string | null>(null),
    [editAmount, setEditAmount] = useState(""),
    [settings, setSettings] = useState(false),
    [started, setStarted] = useState<number | null>(null),
    [seconds, setSeconds] = useState(0),
    [journalCount, setJournalCount] = useState(10),
    [feedback, setFeedback] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      setDay(localDay());
      if (started !== null)
        setSeconds(Math.min(3600, Math.floor((Date.now() - started) / 1000)));
    }, 500);
    return () => clearInterval(t);
  }, [started]);
  const level = levelInfo(totalXP(progress, runs, owner)),
    missions = dailyMissions(progress, day),
    done = missions.filter((m) => m.completed).length,
    sets = activeSets(progress),
    entry = WORKOUTS.find((e) => e.id === exercise)!;
  const value = Number(amount),
    valid =
      /^\d+$/.test(amount) &&
      value >= 1 &&
      value <= (exercise === "plank" ? 3600 : 1000),
    journal = [...sets].sort((a, b) => b.createdAt - a.createdAt);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() - 6 + i);
    const key = localDay(d);
    return {
      day: key,
      label: d.toLocaleDateString("ro-RO", { weekday: "short" }).slice(0, 2),
      xp: WORKOUTS.reduce(
        (n, e) => n + amountXP(e.id, dayAmount(progress, key, e.id)),
        0,
      ),
    };
  });
  const max = Math.max(1, ...week.map((d) => d.xp)),
    weekSets = sets.filter((s) => s.day >= week[0].day && s.day <= day),
    days = new Set(weekSets.map((s) => s.day)).size;
  async function save() {
    if (!valid || busy || started !== null) return;
    const ok = await onAdd(exercise, value);
    if (ok) {
      setFeedback(entry.name + " · " + value + " " + entry.unit + " salvate");
      if (exercise === "plank") setSeconds(0);
    }
  }
  return (
    <View style={s.panel}>
      <View style={s.head}>
        <View style={s.badge}>
          <Trophy size={18} color="#d5fc51" />
          <Text style={s.level}>{level.level}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.eyebrow}>PROGRESUL TĂU</Text>
          <Text style={s.heading}>
            {level.level < 5
              ? "Explorator"
              : level.level < 10
                ? "Cuceritor"
                : "Veteran"}
          </Text>
        </View>
        <Text style={s.total}>
          {level.total.toLocaleString("ro-RO")} <Text style={s.muted}>XP</Text>
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Progres spre nivelul următor"
        accessibilityValue={{ min: 0, max: level.required, now: level.xp }}
        style={s.track}
      >
        <View style={[s.fill, { width: (level.ratio * 100 + "%") as any }]} />
      </View>
      <View style={s.between}>
        <Text style={s.muted}>
          {level.xp} / {level.required} XP
        </Text>
        <Text style={s.muted}>
          Nivel {level.level + 1} · încă {level.required - level.xp}
        </Text>
      </View>
      {compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deschide antrenamentul"
          onPress={onOpen}
          style={s.open}
        >
          <Zap size={18} color="#d5fc51" />
          <Text style={s.openText}>Antrenamentul tău · {done}/3 misiuni</Text>
          <ChevronRight size={18} color="#d5fc51" />
        </Pressable>
      ) : (
        <>
          <View style={s.section}>
            <Text style={s.eyebrow}>ANTRENAMENT / AZI</Text>
            <Text style={s.hero}>Fiecare repetare{"\n"}contează.</Text>
            <Text style={s.help}>
              Adaugă fiecare set după ce îl termini. Poți continua și după
              obiectivul zilei.
            </Text>
          </View>
          <View style={s.tabs}>
            {WORKOUTS.map((e) => (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityState={{ selected: exercise === e.id }}
                disabled={started !== null}
                onPress={() => {
                  setExercise(e.id);
                  setAmount(e.id === "plank" ? "30" : "5");
                  setFeedback("");
                }}
                style={[s.chip, exercise === e.id && s.selected]}
              >
                <Text
                  style={[
                    s.chipText,
                    exercise === e.id && { color: "#111313" },
                  ]}
                >
                  {e.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={s.editor}>
            <View style={s.between}>
              <Text style={s.heading}>{entry.name}</Text>
              <Text style={s.reward}>
                {exercise === "plank"
                  ? "1 XP / 5 sec"
                  : entry.rate + " XP / repetare"}
              </Text>
            </View>
            <View style={s.quantity}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scade cantitatea"
                disabled={started !== null || busy}
                onPress={() =>
                  setAmount(
                    String(
                      Math.max(
                        1,
                        (Number(amount) || 1) - (exercise === "plank" ? 5 : 1),
                      ),
                    ),
                  )
                }
                style={s.adjust}
              >
                <Text style={s.sign}>−</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <TextInput
                  accessibilityLabel="Cantitate set"
                  keyboardType="number-pad"
                  value={started !== null ? String(seconds) : amount}
                  onChangeText={setAmount}
                  editable={started === null && !busy}
                  maxLength={4}
                  selectTextOnFocus
                  style={s.number}
                />
                <Text style={[s.muted, { textAlign: "center" }]}>
                  {entry.unit}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Crește cantitatea"
                disabled={started !== null || busy}
                onPress={() =>
                  setAmount(
                    String(
                      Math.min(
                        exercise === "plank" ? 3600 : 1000,
                        (Number(amount) || 0) + (exercise === "plank" ? 5 : 1),
                      ),
                    ),
                  )
                }
                style={s.adjust}
              >
                <Text style={s.sign}>+</Text>
              </Pressable>
            </View>
            <View style={s.tabs}>
              {(exercise === "plank" ? [15, 30, 60] : [5, 10, 20]).map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={"Alege " + n + " " + entry.unit}
                  disabled={started !== null || busy}
                  onPress={() => setAmount(String(n))}
                  style={s.quick}
                >
                  <Text style={s.chipText}>{n}</Text>
                </Pressable>
              ))}
            </View>
            {exercise === "plank" && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  if (started === null) {
                    setSeconds(0);
                    setStarted(Date.now());
                  } else {
                    setAmount(
                      String(
                        Math.max(
                          1,
                          Math.min(
                            3600,
                            Math.floor((Date.now() - started) / 1000),
                          ),
                        ),
                      ),
                    );
                    setStarted(null);
                  }
                }}
                style={s.open}
              >
                <Timer size={18} color="#b1b7b6" />
                <Text style={s.openText}>
                  {started === null
                    ? "Pornește cronometrul"
                    : "Oprește cronometrul · " + seconds + " sec"}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Salvează setul"
              disabled={busy || !valid || started !== null}
              onPress={() => void save()}
              style={({ pressed }) => [
                s.save,
                {
                  opacity:
                    busy || !valid || started !== null
                      ? 0.4
                      : pressed
                        ? 0.75
                        : 1,
                },
              ]}
            >
              <Plus size={20} color="#111313" />
              <Text style={s.saveText}>Salvează setul</Text>
              <Text style={s.saveText}>
                {valid ? "+" + amountXP(exercise, value) + " XP" : ""}
              </Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite" style={s.help}>
              {feedback ||
                "Azi: " +
                  dayAmount(progress, day, exercise) +
                  " " +
                  entry.unit +
                  " · Record pe set: " +
                  Math.max(
                    0,
                    ...sets
                      .filter((s) => s.exercise === exercise)
                      .map((s) => s.amount),
                  )}
            </Text>
            {exercise === "plank" && (
              <Text style={s.muted}>
                Secundele se adună pe zi pentru XP. Cronometrul măsoară timpul;
                confirmi singur exercițiul.
              </Text>
            )}
          </View>
          <View style={[s.between, s.section]}>
            <View>
              <Text style={s.heading}>Misiuni zilnice</Text>
              <Text style={s.muted}>
                {done}/3 atinse · +20 XP bonus pentru toate
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ajustează obiectivele"
              onPress={() => setSettings(!settings)}
              style={s.adjust}
            >
              <Settings2 size={20} color="#b1b7b6" />
            </Pressable>
          </View>
          {settings && (
            <View style={s.editor}>
              <Text style={s.help}>
                Alege ritmul tău. Dacă ai început deja azi, schimbările se
                aplică de mâine. Obiectivele nu cresc automat.
              </Text>
              {EXERCISES.map((e) => (
                <View key={e.id} style={s.between}>
                  <Text style={[s.heading, { flex: 1 }]}>{e.name}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={"Scade obiectiv " + e.name}
                    disabled={busy}
                    onPress={() =>
                      onGoal(
                        e.id,
                        Math.max(1, (progress.goals?.[e.id] ?? e.base) - 1),
                      )
                    }
                    style={s.adjust}
                  >
                    <Text style={s.sign}>−</Text>
                  </Pressable>
                  <Text style={s.heading}>
                    {progress.goals?.[e.id] ?? e.base}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={"Crește obiectiv " + e.name}
                    disabled={busy}
                    onPress={() =>
                      onGoal(
                        e.id,
                        Math.min(100, (progress.goals?.[e.id] ?? e.base) + 1),
                      )
                    }
                    style={s.adjust}
                  >
                    <Text style={s.sign}>+</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {missions.map((m) => (
            <View key={m.exercise} style={s.mission}>
              <View style={s.between}>
                <Text style={s.heading}>
                  {EXERCISES.find((e) => e.id === m.exercise)!.name}
                </Text>
                <Text style={s.reward}>
                  {m.completed ? "✓  " : ""}
                  {m.amount} / {m.target}
                </Text>
              </View>
              <View style={s.track}>
                <View
                  style={[
                    s.fill,
                    {
                      width: (Math.min(1, m.amount / m.target) * 100 +
                        "%") as any,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
          <View style={s.section}>
            <Text style={s.heading}>Ultimele 7 zile</Text>
            <Text style={s.help}>
              {days} zile active · {weekSets.length} seturi ·{" "}
              {week.reduce((n, d) => n + d.xp, 0)} XP din exerciții
            </Text>
            <View style={s.chart}>
              {week.map((d) => (
                <View key={d.day} style={s.column}>
                  <Text style={s.muted}>{d.xp}</Text>
                  <View style={s.barSpace}>
                    <View
                      style={{
                        height: Math.max(3, (d.xp / max) * 64),
                        width: "70%",
                        borderRadius: 4,
                        backgroundColor: d.day === day ? "#d5fc51" : "#525c58",
                      }}
                    />
                  </View>
                  <Text style={s.muted}>{d.label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={s.section}>
            <View style={s.between}>
              <Text style={s.heading}>Jurnalul exercițiilor</Text>
              <Text style={s.muted}>{sets.length} seturi</Text>
            </View>
            <Text style={s.help}>
              Poți corecta sau șterge un set. XP-ul și bonusul zilei se
              recalculează.
            </Text>
          </View>
          {journal.length === 0 && (
            <Text style={s.help}>
              Primul set apare aici imediat ce îl salvezi.
            </Text>
          )}
          {journal.slice(0, journalCount).map((item) => {
            const e = WORKOUTS.find((e) => e.id === item.exercise)!;
            return (
              <View key={item.id} style={s.mission}>
                <View style={s.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.heading}>
                      {e.name} · {item.amount} {e.unit}
                    </Text>
                    <Text style={s.muted}>
                      {new Date(item.createdAt).toLocaleString("ro-RO", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={"Corectează set " + e.name}
                    disabled={busy}
                    onPress={() => {
                      setEditing(editing === item.id ? null : item.id);
                      setEditAmount(String(item.amount));
                    }}
                    style={s.adjust}
                  >
                    <Pencil size={17} color="#b1b7b6" />
                  </Pressable>
                </View>
                {editing === item.id && (
                  <View style={s.tabs}>
                    <TextInput
                      accessibilityLabel="Cantitate corectată"
                      keyboardType="number-pad"
                      value={editAmount}
                      onChangeText={setEditAmount}
                      maxLength={4}
                      style={s.editInput}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirmă corectarea"
                      disabled={busy || !/^\d+$/.test(editAmount)}
                      onPress={async () => {
                        if (await onEdit(item.id, Number(editAmount)))
                          setEditing(null);
                      }}
                      style={s.adjust}
                    >
                      <Check size={20} color="#d5fc51" />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Șterge setul"
                      disabled={busy}
                      onPress={async () => {
                        if (await onEdit(item.id, null)) setEditing(null);
                      }}
                      style={s.adjust}
                    >
                      <Trash2 size={19} color="#f3a89b" />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
          {journal.length > journalCount && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setJournalCount(journalCount + 20)}
              style={s.open}
            >
              <Text style={s.openText}>Arată mai multe seturi</Text>
              <ChevronRight size={18} color="#b1b7b6" />
            </Pressable>
          )}
          {progress.missions.some((m) => m.completed) && (
            <Text style={s.muted}>
              XP-ul misiunilor din versiunile anterioare este păstrat separat.
              Jurnalul include seturile înregistrate de acum.
            </Text>
          )}
          <Text style={s.help}>
            Ieșirile aduc 10 XP / km valid (max. 100), plus 1 XP / 500 m² noi
            (max. 200 pe ieșire). Tot progresul se salvează pe telefon și intră
            în copia de siguranță.
          </Text>
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  panel: { backgroundColor: "#191d1d", padding: 20, borderRadius: 22, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: "#292f27",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  level: { color: "#d5fc51", fontSize: 19, fontWeight: "800" },
  eyebrow: { color: "#919b98", fontSize: 9, letterSpacing: 2 },
  heading: { color: "#f2f3ef", fontSize: 15, fontWeight: "600" },
  total: { color: "#f2f3ef", fontSize: 23, fontWeight: "600" },
  track: {
    height: 5,
    backgroundColor: "#303635",
    borderRadius: 9,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: "#d5fc51", borderRadius: 9 },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  muted: { fontSize: 11, color: "#9ca6a2", lineHeight: 18 },
  help: { fontSize: 12, color: "#aab3af", lineHeight: 20 },
  open: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: "#303635",
  },
  openText: { flex: 1, color: "#e8ede8", fontSize: 13 },
  section: { gap: 7, marginTop: 16 },
  hero: {
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -1,
    fontWeight: "600",
    color: "#f2f3ef",
  },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 24,
    backgroundColor: "#282e2c",
  },
  selected: { backgroundColor: "#d5fc51" },
  chipText: { color: "#c5ceca", fontSize: 12, fontWeight: "600" },
  editor: {
    backgroundColor: "#111515",
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  reward: { color: "#d5fc51", fontSize: 12, fontWeight: "600" },
  quantity: { flexDirection: "row", alignItems: "center", gap: 16 },
  number: {
    textAlign: "center",
    fontSize: 52,
    fontWeight: "600",
    color: "#f2f3ef",
    padding: 0,
  },
  adjust: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: "#282e2c",
    alignItems: "center",
    justifyContent: "center",
  },
  sign: { fontSize: 23, color: "#c5ceca" },
  quick: {
    flex: 1,
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#222827",
  },
  save: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#d5fc51",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  saveText: { color: "#111313", fontWeight: "700", fontSize: 13 },
  mission: {
    paddingVertical: 14,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: "#303635",
  },
  chart: { flexDirection: "row", gap: 7, marginTop: 8 },
  column: { flex: 1, alignItems: "center", gap: 5 },
  barSpace: {
    height: 66,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  editInput: {
    minWidth: 80,
    flex: 1,
    color: "#f2f3ef",
    fontSize: 20,
    backgroundColor: "#111515",
    padding: 10,
    borderRadius: 10,
  },
});
