import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Flag,
  Footprints,
  History,
  Layers,
  LocateFixed,
  Map as MapIcon,
  Play,
  Radio,
  RefreshCw,
  Shield,
  Square,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react-native";
import * as Crypto from "expo-crypto";
import ConquerMap from "./src/Map";
import {
  analyze,
  COLORS,
  demoLoop,
  demoPlayers,
  demoRuns,
  distance,
  duration,
  km,
  km2,
  length,
  ME,
  Player,
  Point,
  Run,
  territoriesFromRuns,
  validPoint,
} from "./src/core";
import {
  recordExercise,
  reviseExercise,
  changeGoal,
  ensureProgression,
  changeMission,
  getProgression,
  upgradeRuns,
  exportProgress,
  importProgress,
  getRuns,
  read,
  recording,
  Recording,
  saveRun,
  write,
  finalize,
} from "./src/storage";
import {
  locate,
  nativeBackground,
  startTracking,
  stopTracking,
  recoverTracking,
  trackingError,
} from "./src/tracking";
import { cloud, snapshot, Snapshot, upload } from "./src/cloud";
import { saveBackup, pickBackup } from "./src/backup";
import { Linking } from "react-native";
import ProgressPanel from "./src/ProgressPanel";
import {
  Progression,
  ExerciseId,
  WorkoutId,
  localDay,
  levelInfo,
  totalXP,
  runXP,
} from "./src/progression";
type Tab = "map" | "rank" | "history" | "group";
const ink = "#d5fc51",
  muted = "#909d99";
const allowDemo = __DEV__;
function Button({
  label,
  onPress,
  icon: Icon = ChevronRight,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: any;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary ? s.secondary : s.primary,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text
        style={[s.buttonText, { color: secondary ? "#edf2e9" : "#172018" }]}
      >
        {label}
      </Text>
      <Icon size={18} color={secondary ? "#edf2e9" : "#172018"} />
    </Pressable>
  );
}
function AppContent() {
  const { width } = useWindowDimensions(),
    wide = width >= 1050;
  const [tab, setTab] = useState<Tab>("map"),
    [demo, setDemo] = useState(false),
    [ready, setReady] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [rec, setRec] = useState<Recording | null>(null),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [center, setCenter] = useState<Point | null>(null),
    [focus, setFocus] = useState(0),
    [selected, setSelected] = useState<Run | null>(null);
  const [group, setGroup] = useState<Snapshot | null>(null),
    [userId, setUserId] = useState<string | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [invite, setInvite] = useState("");
  const [progress, setProgress] = useState<Progression | null>(null);
  useEffect(() => {
    ensureProgression()
      .then(setProgress)
      .catch((e) => setNotice(e.message));
  }, []);
  const sessionRevision = useRef(0);
  const ownId = demo ? "me" : userId || "me";
  const players: Player[] = demo
    ? demoPlayers
    : group?.players || [{ ...ME, id: ownId, name: name || "Tu" }];
  const territories = useMemo(
    () =>
      !demo && group
        ? group.territories
        : territoriesFromRuns(
            demo ? runs : runs.filter((r) => r.playerId === ownId),
          ),
    [runs, demo, group, ownId],
  );
  const mine = territories.find((t) => t.playerId === ownId)?.area || 0;
  const ranks = players
    .map((p) => ({
      ...p,
      area: territories.find((t) => t.playerId === p.id)?.area || 0,
    }))
    .sort((a, b) => b.area - a.area);
  const position = ranks.findIndex((p) => p.id === ownId) + 1;
  const activePoints = (rec?.points || []).filter(validPoint);
  const allDistance = runs
    .filter((r) => r.playerId === ownId)
    .reduce((sum, r) => sum + r.distance, 0);
  async function refreshCloud() {
    if (!cloud) return;
    const rev = ++sessionRevision.current;
    const { data, error } = await cloud.auth.getSession();
    if (error) throw error;
    const id = data.session?.user.id || null;
    setUserId(id);
    if (!id) {
      setGroup(null);
      return;
    }
    const cached = await read<Snapshot | null>("group:" + id, null);
    if (rev !== sessionRevision.current) return;
    setGroup(cached);
    try {
      const fresh = await snapshot();
      if (rev !== sessionRevision.current) return;
      setGroup(fresh);
      await write("group:" + id, fresh);
    } catch (e) {
      if (cached) {
        setNotice(
          "Grup offline: afișăm ultima hartă salvată. Reîncearcă sincronizarea când revine internetul.",
        );
      } else throw e;
    }
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : String((e as any)?.message || e),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      let mode = allowDemo ? await read("demo", false) : false;
      const current = await recoverTracking();
      if (current) mode = false;
      let saved = mode ? await getRuns(true) : await upgradeRuns();
      if (mode && !saved.length) {
        saved = demoRuns();
        await write("demo-runs", saved);
      }
      if (alive) {
        setDemo(mode);
        setRuns(saved);
        setRec(current);
        setSelected(saved.at(-1) || null);
        setFocus((v) => v + 1);
        setReady(true);
      }
    })().catch((e) => {
      setNotice("Datele locale nu au putut fi citite: " + e.message);
      setReady(true);
    });
    refreshCloud().catch((e) => setNotice(e.message));
    const sub = cloud?.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id || null);
      sessionRevision.current++;
      setGroup(null);
      setTimeout(() => refreshCloud().catch((e) => setNotice(e.message)), 0);
    });
    return () => {
      alive = false;
      sub?.data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (rec && rec.status !== "stopped") setNow(Date.now());
      if (!demo)
        recording()
          .then((r) => {
            setRec(r);
            if (trackingError()) setNotice(trackingError());
          })
          .catch((e) => setNotice(e.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [demo, rec?.id]);
  useEffect(() => {
    if (rec && activePoints.length) {
      setCenter(activePoints[0]);
      setFocus((v) => v + 1);
    }
  }, [rec?.id, activePoints[0]?.timestamp]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active")
        recoverTracking()
          .then(setRec)
          .catch(() => {});
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!cloud || demo || !group?.group.id || !userId) return;
    const refresh = () => {
      void refreshCloud().catch(() => {});
    };
    const channel = cloud
      .channel("conquer:" + group.group.id)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conquer_updates",
          filter: "group_id=eq." + group.group.id,
        },
        refresh,
      )
      .subscribe();
    const fallback = setInterval(refresh, 30000);
    return () => {
      clearInterval(fallback);
      void cloud?.removeChannel(channel);
    };
  }, [demo, group?.group.id, userId]);
  async function switchMode() {
    if (rec) return;
    await act(async () => {
      const next = !demo;
      let saved = await getRuns(next);
      if (next && !saved.length) {
        saved = demoRuns();
        await write("demo-runs", saved);
      }
      await write("demo", next);
      setDemo(next);
      setRuns(saved);
      setSelected(null);
      setCenter(null);
      setFocus((v) => v + 1);
      setNotice(
        next
          ? "Mod demo: toate activitățile de aici sunt simulate."
          : "Mod real: activitățile sunt salvate pe acest dispozitiv.",
      );
    });
  }
  function primary() {
    if (
      rec &&
      rec.status !== "stopped" &&
      activePoints.length > 1 &&
      distance(activePoints[0], activePoints.at(-1)!) > 40 &&
      !analyze(
        activePoints,
        territories.find((t) => t.playerId === ownId)?.polygon || [],
      ).area &&
      Platform.OS !== "web"
    ) {
      Alert.alert(
        "Bucla nu este încă închisă",
        "Ești la " +
          Math.round(distance(activePoints[0], activePoints.at(-1)!)) +
          " m de start. Pentru teritoriu, închide conturul sau reintră în zona ta.",
        [
          { text: "Continui alergarea", style: "cancel" },
          {
            text: "Salvez fără captură",
            onPress: () => {
              void primaryConfirmed();
            },
          },
        ],
      );
      return;
    }
    void primaryConfirmed();
  }
  async function primaryConfirmed() {
    await act(async () => {
      if (demo) {
        const pts = demoLoop(
          44.436 + (runs.length % 3) * 0.001,
          26.083,
          1.5,
          Date.now() - 640000,
        );
        const result = analyze(pts);
        const run: Run = {
          id: Crypto.randomUUID(),
          playerId: "me",
          startedAt: pts[0].timestamp,
          finishedAt: pts.at(-1)!.timestamp,
          points: pts,
          ...result,
        };
        setRuns(await saveRun(run, true));
        setSelected(run);
        setFocus((v) => v + 1);
        setNotice(
          "Captură simulată: " +
            km2(run.area) +
            " km². Suprapunerile au fost transferate.",
        );
        return;
      }
      if (rec) {
        await stopTracking();
        const result = await finalize();
        if (!result) throw new Error("Activitatea nu mai este disponibilă.");
        setRuns(result.runs);
        setRec(null);
        setSelected(result.run);
        setCenter(null);
        setFocus((v) => v + 1);
        setNotice(result.run.reason + " · salvat pe dispozitiv.");
        if (group && cloud) await sync();
        return;
      }
      const started = await startTracking(ownId);
      setRec(started);
      setSelected(null);
      setNotice(
        nativeBackground
          ? "Înregistrarea a început. Poți bloca ecranul."
          : "Test GPS în prim-plan: păstrează aplicația vizibilă și ecranul aprins.",
      );
    });
  }
  async function sync() {
    if (!cloud || !group)
      throw new Error("Conectează un cont și un grup înainte de sincronizare.");
    const { data: current } = await cloud.auth.getSession();
    if (current.session?.user.id !== ownId)
      throw new Error("Contul s-a schimbat. Reîncarcă grupul.");
    const local = await getRuns(false);
    for (const run of local) {
      if (!run.synced && run.playerId === ownId) {
        const result = await upload(run);
        run.area = result.area;
        run.distance = result.distance;
        run.reason = result.reason;
        if (!result.area) run.polygon = [];
        run.synced = true;
        await write("runs", local);
      }
    }
    setRuns(local);
    const fresh = await snapshot();
    setGroup(fresh);
    await write("group:" + ownId, fresh);
    setNotice("Grupul și activitățile sunt sincronizate.");
  }
  async function auth(signup: boolean) {
    await act(async () => {
      if (!cloud) throw new Error("Serverul grupului nu este încă configurat.");
      if (!email.trim() || password.length < 8)
        throw new Error("Introdu emailul și o parolă de minimum 8 caractere.");
      const { error } = signup
        ? await cloud.auth.signUp({ email: email.trim(), password })
        : await cloud.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
      if (error) throw error;
      setPassword("");
      setNotice(
        signup
          ? "Cont creat. Verifică emailul dacă este solicitată confirmarea."
          : "Te-ai conectat.",
      );
    });
  }
  async function join(create: boolean) {
    await act(async () => {
      if (!cloud) return;
      if (!name.trim()) throw new Error("Alege un nume de jucător.");
      const { error } = await cloud.rpc(
        create ? "conquer_create_group" : "conquer_join_group",
        create
          ? { player_name: name.trim(), group_name: "Echipa Conquer" }
          : { player_name: name.trim(), invite_code: invite.trim() },
      );
      if (error) throw error;
      await refreshCloud();
      setNotice("Grupul este pregătit.");
    });
  }
  async function applyProgress(
    action: () => Promise<Progression>,
    message: string,
  ) {
    let success = false;
    await act(async () => {
      const before = progress ? totalXP(progress, runs, ownId) : 0;
      const updated = await action();
      setProgress(updated);
      const after = totalXP(updated, runs, ownId),
        delta = after - before;
      setNotice(
        message +
          (delta ? " · " + (delta > 0 ? "+" : "") + delta + " XP" : "") +
          (levelInfo(after).level > levelInfo(before).level
            ? " · Nivel " + levelInfo(after).level + "!"
            : ""),
      );
      success = true;
    });
    return success;
  }
  async function addSet(id: WorkoutId, amount: number) {
    const now = Date.now();
    return applyProgress(
      () =>
        recordExercise({
          id: Crypto.randomUUID(),
          exercise: id,
          amount,
          day: localDay(),
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }),
      "Set salvat",
    );
  }
  const panel = (compact = false) =>
    progress && !demo ? (
      <ProgressPanel
        progress={progress}
        runs={runs}
        owner={ownId}
        busy={busy}
        compact={compact}
        onOpen={() => setTab("history")}
        onAdd={addSet}
        onEdit={(id, amount) =>
          applyProgress(
            () => reviseExercise(id, amount),
            amount === null ? "Set șters" : "Set corectat",
          )
        }
        onGoal={(id, target) => {
          void applyProgress(
            () => changeGoal(id, target),
            "Obiectiv actualizat",
          );
        }}
      />
    ) : null;
  const nav = [
    { id: "map", label: "Teritorii", icon: MapIcon },
    { id: "rank", label: "Clasament", icon: Trophy },
    { id: "history", label: "Activități", icon: History },
    { id: "group", label: "Echipa", icon: Users },
  ] as const;
  const Ranking = () => (
    <View style={s.card}>
      <View style={s.sectionHead}>
        <Text style={s.cardTitle}>În lupta pentru teritoriu</Text>
        <Trophy size={18} color={ink} />
      </View>
      {ranks.map((p, i) => (
        <View key={p.id} style={[s.rankRow, p.id === ownId && s.myRank]}>
          <Text style={s.rankNumber}>{String(i + 1).padStart(2, "0")}</Text>
          <View
            style={[
              s.avatar,
              { backgroundColor: p.color + "22", borderColor: p.color + "66" },
            ]}
          >
            <Text style={{ color: p.color, fontWeight: "700" }}>
              {p.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.playerName}>
              {p.name}
              {p.id === ownId ? "  ·  tu" : ""}
            </Text>
            <View style={s.bar}>
              <View
                style={{
                  height: 3,
                  width: ((ranks[0]?.area
                    ? Math.max(3, (p.area / ranks[0].area) * 100)
                    : 0) + "%") as `${number}%`,
                  backgroundColor: p.color,
                }}
              />
            </View>
          </View>
          <Text style={s.rankArea}>
            {km2(p.area)} <Text style={s.small}>km²</Text>
          </Text>
        </View>
      ))}
      {!demo && !group && (
        <Text style={s.help}>
          Clasamentul privat va apărea după conectarea grupului.
        </Text>
      )}
    </View>
  );
  const ActivityList = () => (
    <View style={s.card}>
      <View style={s.sectionHead}>
        <Text style={s.cardTitle}>Ultimele ieșiri</Text>
        <History size={18} color={muted} />
      </View>
      {[...runs]
        .filter((r) => demo || r.playerId === ownId)
        .reverse()
        .slice(0, tab === "history" ? 100 : 3)
        .map((r) => (
          <Pressable
            key={r.id}
            onPress={() => {
              setSelected(r);
              setCenter(null);
              setFocus((v) => v + 1);
              setTab("map");
            }}
            style={s.activity}
          >
            <View style={s.activityIcon}>
              <Footprints size={19} color={ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.playerName}>
                {players.find((p) => p.id === r.playerId)?.name || "Tu"} ·{" "}
                {r.area ? "Buclă cucerită" : "Alergare"}
              </Text>
              <Text style={s.help}>
                {new Date(r.finishedAt).toLocaleDateString("ro-RO")} ·{" "}
                {km(r.distance)} km · {duration(r.finishedAt - r.startedAt)}
              </Text>
            </View>
            <Text style={{ color: ink, fontSize: 12 }}>+{km2(r.area)} km²</Text>
          </Pressable>
        ))}
      {!runs.length && (
        <Text style={s.help}>
          Prima ieșire începe cu un pas. Traseele salvate vor apărea aici.
        </Text>
      )}
    </View>
  );
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <View style={[s.shell, !wide && { padding: 16, gap: 16 }]}>
        <View style={s.header}>
          <View style={s.logoRow}>
            <View style={s.logo}>
              <Flag size={23} color="#142011" fill="#142011" />
            </View>
            <View>
              <Text style={s.brand}>
                CONQUER<Text style={{ color: ink }}> /</Text>
              </Text>
              <Text style={s.brandSub}>FIECARE PAS CONTEAZĂ.</Text>
            </View>
          </View>
          {wide && (
            <View style={s.nav}>
              {nav.map((n) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === n.id }}
                  key={n.id}
                  onPress={() => setTab(n.id)}
                  style={[s.navItem, tab === n.id && s.navActive]}
                >
                  <n.icon size={16} color={tab === n.id ? ink : muted} />
                  <Text
                    style={{
                      color: tab === n.id ? "#f1f4e9" : muted,
                      fontSize: 13,
                    }}
                  >
                    {n.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable onPress={() => setTab("group")} style={s.headerGroup}>
            <View style={s.liveDot} />
            <Text style={s.headerGroupText}>
              {demo ? "Echipa de 5" : group?.group.name || "Spațiul tău"}
            </Text>
            <View style={s.miniAvatar}>
              <Text style={{ fontWeight: "700", color: ink }}>C</Text>
            </View>
          </Pressable>
        </View>
        <View style={s.modeRow}>
          <Text style={s.eyebrow}>
            {demo ? "DEMO / DATE SIMULATE" : "CONQUER / MOVE. TRAIN. GROW."}
          </Text>
          {allowDemo && (
            <Pressable
              disabled={!!rec || busy}
              onPress={switchMode}
              accessibilityRole="button"
              style={s.modeSwitch}
            >
              <Text style={{ color: ink, fontSize: 12 }}>
                {demo ? "Treci la activități reale" : "Explorează modul demo"}
              </Text>
              <ArrowUpRight size={14} color={ink} />
            </Pressable>
          )}
        </View>
        {!wide && (
          <View style={s.mobileNav}>
            {nav.map((n) => (
              <Pressable
                key={n.id}
                onPress={() => setTab(n.id)}
                style={[s.mobileNavItem, tab === n.id && s.navActive]}
              >
                <n.icon size={17} color={tab === n.id ? ink : muted} />
                <Text
                  style={{ color: tab === n.id ? ink : muted, fontSize: 10 }}
                >
                  {n.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!notice && (
          <View accessibilityRole="alert" style={s.notice}>
            <Text style={s.noticeText}>{notice}</Text>
            <Pressable
              accessibilityLabel="Închide mesajul"
              onPress={() => setNotice("")}
            >
              <X size={17} color={muted} />
            </Pressable>
          </View>
        )}
        {!ready ? (
          <ActivityIndicator color={ink} style={{ flex: 1 }} />
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingBottom: !wide && tab === "map" ? 125 : 24,
              gap: 22,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.titleRow}>
              <View>
                <Text style={[s.title, !wide && { fontSize: 25 }]}>
                  {tab === "map"
                    ? wide
                      ? "Orașul e terenul tău."
                      : "Teritoriile tale."
                    : tab === "rank"
                      ? "Fiecare metru schimbă jocul."
                      : tab === "history"
                        ? "Mai puternic. Zi de zi."
                        : "Împreună. În competiție."}
                </Text>
                <Text style={s.subtitle}>
                  {tab === "map"
                    ? "Închide o buclă și salvează alergarea pentru captură."
                    : tab === "rank"
                      ? "Suprafața deținută acum decide clasamentul."
                      : tab === "history"
                        ? "Antrenamente, ieșiri și progres. În ritmul tău."
                        : "Un grup privat. Cinci jucători. Un oraș de cucerit."}
                </Text>
              </View>
              {wide && (
                <View style={s.pill}>
                  <Shield size={14} color={ink} />
                  <Text style={s.small}>GRUP PRIVAT</Text>
                </View>
              )}
            </View>
            {tab === "map" && (
              <>
                {panel(true)}
                {selected && !rec && (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>
                      Activitate salvată ·{" "}
                      {new Date(selected.finishedAt).toLocaleDateString(
                        "ro-RO",
                      )}
                    </Text>
                    <Text style={s.help}>
                      {km(selected.distance)} km ·{" "}
                      {duration(selected.finishedAt - selected.startedAt)} ·{" "}
                      {selected.points.length} puncte GPS · +{runXP(selected)}{" "}
                      XP
                    </Text>
                    <Text style={{ color: ink, fontSize: 13 }}>
                      {selected.reason}
                      {selected.area
                        ? " · +" +
                          Math.round(selected.area).toLocaleString("ro-RO") +
                          " m²"
                        : ""}
                    </Text>
                  </View>
                )}
                <View style={[s.stats, !wide && { gap: 8 }]}>
                  {[
                    {
                      label: "TERITORIUL TĂU",
                      value: km2(mine),
                      unit: "km²",
                      icon: Flag,
                    },
                    {
                      label: "LOC ÎN ECHIPĂ",
                      value: String(position).padStart(2, "0"),
                      unit: "/ " + players.length,
                      icon: Trophy,
                    },
                    {
                      label: "DISTANȚĂ TOTALĂ",
                      value: km(allDistance),
                      unit: "km",
                      icon: Footprints,
                    },
                  ].map((v, i) => (
                    <View
                      key={v.label}
                      style={[s.stat, !wide && { padding: 14 }]}
                    >
                      <View style={s.statHead}>
                        <Text style={[s.statLabel, !wide && { fontSize: 8 }]}>
                          {v.label}
                        </Text>
                        {wide && (
                          <v.icon size={17} color={i === 0 ? ink : muted} />
                        )}
                      </View>
                      <Text
                        style={[
                          s.statValue,
                          !wide && { fontSize: 25 },
                          i === 0 && { color: ink },
                        ]}
                      >
                        {v.value}
                        <Text style={s.statUnit}> {v.unit}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={[s.columns, !wide && { flexDirection: "column" }]}>
                  <View style={[s.mapCard, { height: wide ? 550 : 360 }]}>
                    <ConquerMap
                      territories={territories}
                      players={players}
                      points={rec ? activePoints : selected?.points || []}
                      center={center}
                      focus={focus}
                    />
                    <View style={s.mapTop}>
                      <View style={s.mapTag}>
                        <View style={s.liveDot} />
                        <Text style={s.mapTagText}>
                          {demo ? "BUCUREȘTI · DEMO" : "HARTA TERITORIILOR"}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityLabel="Centrează pe locația mea"
                        disabled={busy}
                        style={s.mapControl}
                        onPress={() =>
                          act(async () => {
                            setCenter(await locate());
                            setFocus((v) => v + 1);
                          })
                        }
                      >
                        <LocateFixed size={20} color="#edf2e9" />
                      </Pressable>
                    </View>
                    <View style={s.mapLegend}>
                      <Layers size={15} color={muted} />
                      {players.map((p) => (
                        <View key={p.id} style={s.legendItem}>
                          <View
                            style={[s.liveDot, { backgroundColor: p.color }]}
                          />
                          <Text style={{ color: "#d4dbd4", fontSize: 11 }}>
                            {p.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View
                    style={[
                      s.sidebar,
                      wide ? { width: 325 } : { width: "100%" },
                    ]}
                  >
                    <View style={s.runCard}>
                      <View style={s.sectionHead}>
                        <View style={s.pill}>
                          <Radio size={13} color={ink} />
                          <Text
                            style={{
                              color: ink,
                              fontSize: 10,
                              letterSpacing: 1,
                            }}
                          >
                            {rec
                              ? "ÎNREGISTRARE ACTIVĂ"
                              : demo
                                ? "TESTEAZĂ JOCUL"
                                : "PREGĂTIT DE START"}
                          </Text>
                        </View>
                        <Footprints size={26} color={ink} />
                      </View>
                      <Text style={s.runTitle}>
                        {rec
                          ? "Lasă o urmă."
                          : demo
                            ? "Următoarea zonă\ne a ta."
                            : "Începe cu\nprimul pas."}
                      </Text>
                      <Text style={s.runDescription}>
                        {rec
                          ? "Închide bucla revenind aproape de start."
                          : demo
                            ? "Simulează o alergare și vezi cum preiei teritoriile echipei."
                            : "Înconjoară o zonă pe jos. La final, interiorul buclei primește culoarea ta."}
                      </Text>
                      {rec && (
                        <>
                          <View style={s.recordStats}>
                            <Text style={s.recordNumber}>
                              {duration(
                                (rec.status === "stopped"
                                  ? rec.points.at(-1)?.timestamp ||
                                    rec.startedAt
                                  : now) - rec.startedAt,
                              )}
                            </Text>
                            <Text style={s.recordNumber}>
                              {km(length(activePoints))} km
                            </Text>
                          </View>
                          <Text style={s.help}>
                            {activePoints.length
                              ? "GPS ±" +
                                Math.round(activePoints.at(-1)!.accuracy) +
                                " m · " +
                                Math.round(
                                  distance(
                                    activePoints[0],
                                    activePoints.at(-1)!,
                                  ),
                                ) +
                                " m până la start"
                              : "Se caută semnal GPS…"}
                          </Text>
                          {!!rec.error && (
                            <Text style={s.warning}>{rec.error}</Text>
                          )}
                        </>
                      )}
                      <Button
                        label={
                          busy
                            ? "Se procesează…"
                            : rec
                              ? rec.status === "stopped"
                                ? "Salvează activitatea recuperată"
                                : "Oprește și salvează"
                              : demo
                                ? "Simulează o cucerire"
                                : "Începe alergarea"
                        }
                        icon={rec ? Square : Play}
                        disabled={busy}
                        onPress={primary}
                      />
                      <Text style={s.footnote}>
                        {demo
                          ? "Datele demo sunt separate de alergările reale."
                          : nativeBackground
                            ? "Traseu și teritoriu salvate pe telefon"
                            : "Browser / Expo Go: test cu ecranul aprins."}
                      </Text>
                    </View>
                    <View style={s.tip}>
                      <View style={s.sectionHead}>
                        <Zap size={18} color={ink} />
                        <Text style={s.tipTitle}>
                          Închide bucla. Ia teritoriul.
                        </Text>
                      </View>
                      <Text style={s.help}>
                        Minimum 200 m și 500 m² noi. Închide traseul la maximum
                        40 m de start sau ieși din teritoriul tău și reintră în
                        el.
                      </Text>
                    </View>
                    <View style={s.teamMini}>
                      <View style={s.overlap}>
                        {players.map((p, i) => (
                          <View
                            key={p.id}
                            style={[
                              s.tinyFace,
                              {
                                backgroundColor: p.color,
                                marginLeft: i ? -7 : 0,
                              },
                            ]}
                          >
                            <Text style={{ fontWeight: "700", fontSize: 11 }}>
                              {p.name[0]}
                            </Text>
                          </View>
                        ))}
                      </View>
                      <Text style={s.help}>
                        {demo
                          ? "5 rivali. Aceeași hartă."
                          : group
                            ? players.length + " jucători în echipă"
                            : "Construiește-ți echipa."}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={[s.columns, !wide && { flexDirection: "column" }]}>
                  <View style={{ flex: 1 }}>
                    <Ranking />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ActivityList />
                  </View>
                </View>
              </>
            )}
            {tab === "rank" && <Ranking />}
            {tab === "history" && (
              <>
                {panel()}
                <ActivityList />
                <View style={s.card}>
                  <Text style={s.cardTitle}>Progresul tău</Text>
                  <Text style={s.help}>
                    Activitățile se salvează automat pe acest dispozitiv.
                    Exportă o copie pentru siguranță sau pentru mutarea din
                    browser în aplicație.
                  </Text>
                  <Button
                    label="Exportă progresul"
                    secondary
                    disabled={busy || !!rec || demo}
                    onPress={() =>
                      act(async () => {
                        await saveBackup(await exportProgress());
                        setNotice(
                          "Copia progresului a fost pregătită. Păstrează fișierul Conquer-progres.json.",
                        );
                      })
                    }
                  />
                  <Button
                    label="Importă progresul"
                    secondary
                    disabled={busy || !!rec || demo || !!userId}
                    onPress={() =>
                      act(async () => {
                        const text = await pickBackup();
                        if (text === null) return;
                        const result = await importProgress(text);
                        setRuns(result.runs);
                        setProgress(result.progression);
                        setSelected(result.runs.at(-1) || null);
                        setCenter(null);
                        setFocus((v) => v + 1);
                        setNotice(
                          result.count +
                            " activități importate. Progresul existent este păstrat.",
                        );
                      })
                    }
                  />
                  {Platform.OS === "web" && (
                    <Button
                      label="Instalează aplicația Android"
                      onPress={() => {
                        void Linking.openURL("/android/");
                      }}
                    />
                  )}
                </View>
              </>
            )}
            {tab === "group" && (
              <View style={[s.columns, !wide && { flexDirection: "column" }]}>
                <View style={[s.card, { flex: 1, gap: 18 }]}>
                  <Users size={30} color={ink} />
                  <Text style={s.cardTitle}>
                    {demo
                      ? "Echipa demonstrativă"
                      : group?.group.name || "Creează-ți echipa"}
                  </Text>
                  <Text style={s.help}>
                    {demo
                      ? "Alex, Mara, Vlad și Daria sunt jucători fictivi. Treci în modul real pentru contul și grupul tău."
                      : group
                        ? "Codul de invitație permite accesul la grup. Trimite-l doar prietenilor tăi."
                        : "Datele rămân pe dispozitiv până când conectezi grupul online."}
                  </Text>
                  {demo ? (
                    <Button label="Treci în modul real" onPress={switchMode} />
                  ) : rec ? (
                    <Text style={s.help}>
                      Salvează activitatea în curs înainte de a schimba contul
                      sau grupul.
                    </Text>
                  ) : !cloud ? (
                    <View style={s.tip}>
                      <Text style={s.playerName}>
                        Grupul online nu este încă conectat.
                      </Text>
                      <Text style={s.help}>
                        Poți înregistra trasee și captura teritorii local.
                        Configurarea serverului este următorul pas pentru
                        competiția între telefoane.
                      </Text>
                    </View>
                  ) : !userId ? (
                    <>
                      <TextInput
                        style={s.input}
                        placeholder="Email"
                        placeholderTextColor={muted}
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        accessibilityLabel="Email"
                      />
                      <TextInput
                        style={s.input}
                        placeholder="Parolă · minimum 8 caractere"
                        placeholderTextColor={muted}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        accessibilityLabel="Parolă"
                      />
                      <Button
                        label="Conectează-te"
                        onPress={() => auth(false)}
                        disabled={busy}
                      />
                      <Button
                        label="Creează cont"
                        onPress={() => auth(true)}
                        secondary
                        disabled={busy}
                      />
                    </>
                  ) : !group ? (
                    <>
                      <TextInput
                        style={s.input}
                        placeholder="Numele tău în joc"
                        placeholderTextColor={muted}
                        value={name}
                        onChangeText={setName}
                        maxLength={30}
                        accessibilityLabel="Numele tău"
                      />
                      <Button
                        label="Creează grup de 5"
                        onPress={() => join(true)}
                        disabled={busy}
                      />
                      <TextInput
                        style={s.input}
                        placeholder="Cod de invitație"
                        placeholderTextColor={muted}
                        value={invite}
                        onChangeText={setInvite}
                        autoCapitalize="none"
                        accessibilityLabel="Cod de invitație"
                      />
                      <Button
                        label="Intră în grup"
                        onPress={() => join(false)}
                        secondary
                        disabled={busy}
                      />
                    </>
                  ) : (
                    <>
                      <Text selectable style={s.invite}>
                        {group.group.invite}
                      </Text>
                      <Button
                        label="Sincronizează activitățile"
                        onPress={() => act(sync)}
                        icon={RefreshCw}
                        disabled={busy}
                      />
                      <Text style={s.help}>
                        Activități în așteptare:{" "}
                        {
                          runs.filter((r) => !r.synced && r.playerId === ownId)
                            .length
                        }
                      </Text>
                    </>
                  )}
                  {!demo && userId && !rec && (
                    <Button
                      label="Deconectare"
                      secondary
                      onPress={() =>
                        act(async () => {
                          await cloud?.auth.signOut();
                          setGroup(null);
                        })
                      }
                      disabled={busy}
                    />
                  )}
                </View>
                <View style={{ flex: 1, gap: 18 }}>
                  <Ranking />
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Regulile echipei</Text>
                    {[
                      "Mers și alergare, în același joc.",
                      "Ultima captură validată preia suprapunerea.",
                      "Traseul tău este privat; echipa vede teritoriile.",
                      "Ieși din zona ta și reintră: granița existentă închide captura.",
                    ].map((t) => (
                      <View style={s.rule} key={t}>
                        <Check size={16} color={ink} />
                        <Text style={[s.help, { flex: 1 }]}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
            <View style={s.footer}>
              <Text style={s.footerText}>CONQUER / 0.5.0</Text>
              <Text style={s.footerText}>
                {demo ? "EXPLORARE DEMO" : "CONSTRUIT PENTRU PAȘII TĂI"}
              </Text>
            </View>
          </ScrollView>
        )}
        {!wide && tab === "map" && ready && (
          <View style={s.stickyRun}>
            {rec && (
              <View style={s.recordStats}>
                <Text style={s.help}>
                  {duration(
                    (rec.status === "stopped"
                      ? rec.points.at(-1)?.timestamp || rec.startedAt
                      : now) - rec.startedAt,
                  )}{" "}
                  · {km(length(activePoints))} km
                </Text>
                <Text style={s.help}>
                  {activePoints.length
                    ? "GPS ±" + Math.round(activePoints.at(-1)!.accuracy) + " m"
                    : "Așteaptă semnal GPS"}
                </Text>
              </View>
            )}
            <Button
              label={
                busy
                  ? "Se procesează…"
                  : rec
                    ? rec.status === "stopped"
                      ? "Salvează activitatea recuperată"
                      : "Oprește și salvează"
                    : "Începe alergarea"
              }
              icon={rec ? Square : Play}
              disabled={busy}
              onPress={primary}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  stickyRun: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#181f1b",
    borderWidth: 1,
    borderColor: "#3a4437",
    gap: 7,
  },
  safe: { flex: 1, backgroundColor: "#101414" },
  shell: {
    flex: 1,
    paddingHorizontal: 40,
    paddingTop: 24,
    maxWidth: 1560,
    width: "100%",
    alignSelf: "center",
    gap: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderColor: "#27312d",
    gap: 12,
  },
  logoRow: { flexDirection: "row", gap: 11, alignItems: "center" },
  logo: {
    width: 40,
    height: 44,
    borderRadius: 12,
    backgroundColor: ink,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#f3f5e9",
  },
  brandSub: { fontSize: 8, letterSpacing: 2.3, color: muted, marginTop: 4 },
  nav: { flexDirection: "row", gap: 6 },
  navItem: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 17,
    borderRadius: 9,
    alignItems: "center",
  },
  navActive: { backgroundColor: "#2b322b" },
  headerGroup: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerGroupText: { maxWidth: 85, fontSize: 11, color: "#ced7ca" },
  miniAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#2b322b",
    alignItems: "center",
    justifyContent: "center",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ink },
  modeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  eyebrow: { fontSize: 9, letterSpacing: 2, color: muted },
  modeSwitch: { flexDirection: "row", alignItems: "center", gap: 5 },
  mobileNav: { flexDirection: "row", gap: 6 },
  mobileNavItem: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    padding: 10,
    borderRadius: 10,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#4a573b",
    backgroundColor: "#202a1c",
    borderRadius: 10,
  },
  noticeText: { flex: 1, color: "#dce8c9", fontSize: 12, lineHeight: 18 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -1.8,
    color: "#f0f3e8",
  },
  subtitle: { fontSize: 13, color: muted, marginTop: 10, lineHeight: 21 },
  pill: {
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 6,
    backgroundColor: "#283120",
  },
  small: { fontSize: 10, color: muted, letterSpacing: 0.6 },
  stats: { flexDirection: "row", gap: 16 },
  stat: {
    flex: 1,
    padding: 22,
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "#252d29",
    backgroundColor: "#191d1d",
  },
  statHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statLabel: { fontSize: 10, letterSpacing: 1.6, color: muted },
  statValue: {
    fontSize: 37,
    fontWeight: "600",
    color: "#ecf1e5",
    marginTop: 13,
    letterSpacing: -1,
  },
  statUnit: { fontSize: 13, fontWeight: "400", color: muted, letterSpacing: 0 },
  columns: { flexDirection: "row", gap: 22, alignItems: "stretch" },
  mapCard: {
    flex: 1,
    minHeight: 360,
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#364039",
    backgroundColor: "#182027",
  },
  mapTop: {
    position: "absolute",
    top: 18,
    left: 18,
    right: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mapTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#111a18ed",
    borderWidth: 1,
    borderColor: "#3b463c",
    borderRadius: 7,
    padding: 11,
  },
  mapTagText: { color: "#dbe4d7", fontSize: 9, letterSpacing: 1.4 },
  mapControl: {
    padding: 11,
    backgroundColor: "#18211eee",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#435043",
  },
  mapLegend: {
    position: "absolute",
    left: 15,
    bottom: 30,
    backgroundColor: "#141e1bee",
    borderWidth: 1,
    borderColor: "#3b473d",
    padding: 10,
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    maxWidth: "80%",
    alignItems: "center",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  sidebar: { gap: 18 },
  runCard: {
    backgroundColor: "#191f1d",
    borderRadius: 20,
    borderWidth: 0,
    borderColor: "#303735",
    padding: 23,
    gap: 18,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  runTitle: {
    fontSize: 33,
    lineHeight: 37,
    letterSpacing: -1,
    fontWeight: "600",
    color: "#f0f3e6",
  },
  runDescription: { fontSize: 12, lineHeight: 20, color: "#acb79f" },
  button: {
    minHeight: 48,
    paddingHorizontal: 17,
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  primary: { backgroundColor: ink },
  secondary: {
    backgroundColor: "#292f2d",
    borderWidth: 1,
    borderColor: "#3b4540",
  },
  buttonText: { fontWeight: "700", fontSize: 13 },
  footnote: { fontSize: 10, lineHeight: 16, color: "#a6b196" },
  tip: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#252d29",
    gap: 12,
    backgroundColor: "#191d1d",
  },
  tipTitle: { fontSize: 12, fontWeight: "600", color: "#e1e9d8", flex: 1 },
  help: { fontSize: 11, lineHeight: 19, color: muted },
  teamMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
  },
  overlap: { flexDirection: "row" },
  tinyFace: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#111714",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    padding: 22,
    borderRadius: 20,
    borderWidth: 0,
    borderColor: "#252d29",
    backgroundColor: "#191d1d",
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#e7eddf" },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  myRank: { backgroundColor: "#252f21" },
  rankNumber: { fontSize: 12, color: muted, width: 19 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  playerName: { fontSize: 12, fontWeight: "600", color: "#e2e9db" },
  bar: {
    height: 3,
    backgroundColor: "#2c352c",
    borderRadius: 2,
    marginTop: 8,
    width: "90%",
    overflow: "hidden",
  },
  rankArea: { fontSize: 13, color: "#edf1e5", fontWeight: "600" },
  activity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderColor: "#283229",
  },
  activityIcon: { padding: 10, backgroundColor: "#293222", borderRadius: 9 },
  recordStats: { flexDirection: "row", justifyContent: "space-between" },
  recordNumber: { color: "#eef3dc", fontSize: 24, fontWeight: "600" },
  warning: { color: "#ffad86", fontSize: 12 },
  input: {
    color: "#edf2e5",
    backgroundColor: "#101713",
    borderWidth: 1,
    borderColor: "#3c4837",
    padding: 14,
    borderRadius: 8,
    fontSize: 14,
  },
  invite: { fontSize: 21, letterSpacing: 2, color: ink },
  rule: { flexDirection: "row", gap: 10, alignItems: "center", paddingTop: 8 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  footerText: { fontSize: 8, color: "#627265", letterSpacing: 1.8 },
});
