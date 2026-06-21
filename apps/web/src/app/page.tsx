import { Dashboard } from "../components/Dashboard";

export default function Page() {
  return <Dashboard wsUrl={process.env.NEXT_PUBLIC_BOT_WS_URL ?? "ws://localhost:4000/ws"} />;
}
