import ScriptEditor from "./script-editor";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 font-sans">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Scene Partner</h1>
      <ScriptEditor />
    </main>
  );
}
