import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold mb-4">Solutions Studio — Web Application</h1>
        <p className="text-gray-600 mb-6">
          Phase 0 Spike B: Sandboxed React/Tailwind Runtime via Babel.
        </p>
        <Link
          href="/dev/sandbox"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
        >
          Open Prototype Sandbox Tracer &rarr;
        </Link>
      </div>
    </main>
  );
}
