import { EnsureSignedIn } from "./auth";

export default function App() {
  return (
    <EnsureSignedIn>
      <div className="min-h-screen grid place-items-center bg-stone-50 text-stone-900">
        <p className="text-lg">Sentinel — setting up.</p>
      </div>
    </EnsureSignedIn>
  );
}
