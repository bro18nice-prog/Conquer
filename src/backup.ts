import { File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
export async function saveBackup(text: string) {
  const f = new File(Paths.cache, "Conquer-progres.json");
  f.write(text);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(
      "Salvarea fișierelor nu este disponibilă pe acest dispozitiv.",
    );
  await Sharing.shareAsync(f.uri, {
    mimeType: "application/json",
    dialogTitle: "Salvează copia progresului Conquer",
  });
}
export async function pickBackup() {
  const r = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (r.canceled) return null;
  const file = new File(r.assets[0].uri);
  if (file.size > 25000000) throw new Error("Copia este prea mare.");
  return file.text();
}
