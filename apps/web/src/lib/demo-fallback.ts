import type { UserRole } from "@samvedna/shared-types";

/** Local screenshot database. Active while Supabase is still the example placeholder. */
export const DEMO_COOKIE = "samvedna_demo";

export const DEMO_PASSWORD = "Samvedna@2024";
export const DEMO_ADMIN_PASSWORD = "SamvednaAdmin@2024";

export type DemoAccount = {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  full_name: string;
  preferred_language: string;
  phone_number: string | null;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@samvedna.demo",
    password: DEMO_ADMIN_PASSWORD,
    role: "admin",
    full_name: "System Admin",
    preferred_language: "en",
    phone_number: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222221",
    email: "counsellor1@samvedna.demo",
    password: DEMO_PASSWORD,
    role: "counsellor",
    full_name: "Dr. Priya Sharma",
    preferred_language: "hi",
    phone_number: "+919876543211",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "counsellor2@samvedna.demo",
    password: DEMO_PASSWORD,
    role: "counsellor",
    full_name: "Dr. Ananya Iyer",
    preferred_language: "ta",
    phone_number: "+919876543212",
  },
  {
    id: "33333333-3333-4333-8333-333333333331",
    email: "victim1@samvedna.demo",
    password: DEMO_PASSWORD,
    role: "victim",
    full_name: "Meera Devi",
    preferred_language: "hi",
    phone_number: "+919800000001",
  },
  {
    id: "33333333-3333-4333-8333-333333333334",
    email: "victim4@samvedna.demo",
    password: DEMO_PASSWORD,
    role: "victim",
    full_name: "Fatima Khan",
    preferred_language: "en",
    phone_number: "+919800000004",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    email: "official@samvedna.demo",
    password: DEMO_PASSWORD,
    role: "official",
    full_name: "District Desk Officer",
    preferred_language: "en",
    phone_number: "+919811111111",
  },
];

type DemoSession = Omit<DemoAccount, "password">;

type Row = Record<string, unknown>;

const PROFILES: Row[] = DEMO_ACCOUNTS.map((a) => ({
  id: a.id,
  role: a.role,
  full_name: a.full_name,
  preferred_language: a.preferred_language,
  phone_number: a.phone_number,
  created_at: "2026-01-10T08:00:00.000Z",
  onboarding_completed_at: "2026-01-15T08:00:00.000Z",
}));

const CHECKINS: Row[] = [
  {
    id: "chk-1",
    case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    victim_id: "33333333-3333-4333-8333-333333333331",
    channel: "chat",
    raw_transcript:
      "The hearing is next week. I could not sleep. Someone from the other side waited near the lane again.",
    created_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
  },
  {
    id: "chk-2",
    case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    victim_id: "33333333-3333-4333-8333-333333333331",
    channel: "app",
    raw_transcript:
      "I spoke with my sister. I am still frightened, but I ate today and I will come to the check-in.",
    created_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
  },
  {
    id: "chk-4",
    case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    victim_id: "33333333-3333-4333-8333-333333333334",
    channel: "chat",
    raw_transcript:
      "I felt anxious about the court date, but I am coping. The counsellor call last week helped.",
    created_at: new Date(Date.now() - 10 * 3600_000).toISOString(),
  },
];

const TABLES: Record<string, Row[]> = {
  profiles: PROFILES,
  checkins: CHECKINS,
};

export function isDemoFallback(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "0") return false;
  if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "1") return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return !url || url.includes("your-project");
}

export function parseDemoCookie(raw: string | undefined | null): DemoSession | null {
  if (!raw) return null;
  const value = raw.includes("%") ? decodeURIComponent(raw) : raw;
  const account = DEMO_ACCOUNTS.find((a) => a.id === value || a.email === value);
  if (!account) return null;
  const { password: _password, ...session } = account;
  return session;
}

function sessionOf(account: DemoAccount): DemoSession {
  const { password: _password, ...session } = account;
  return session;
}

function toAuthUser(session: DemoSession) {
  return {
    id: session.id,
    email: session.email,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: {
      role: session.role,
      full_name: session.full_name,
      preferred_language: session.preferred_language,
      onboarding_completed: true,
    },
    app_metadata: {},
    created_at: "2026-01-10T08:00:00.000Z",
  };
}

function readBrowserCookie(): DemoSession | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${DEMO_COOKIE}=`));
  if (!hit) return null;
  return parseDemoCookie(hit.slice(DEMO_COOKIE.length + 1));
}

function writeBrowserCookie(session: DemoSession | null) {
  if (typeof document === "undefined") return;
  if (!session) {
    document.cookie = `${DEMO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${DEMO_COOKIE}=${session.id}; Path=/; Max-Age=604800; SameSite=Lax`;
}

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let orderCol = "created_at";
  let ascending = true;

  const run = () => {
    const rows = (TABLES[table] ?? []).filter((row) =>
      filters.every(([key, value]) => row[key] === value)
    );
    return [...rows].sort((a, b) => {
      const av = String(a[orderCol] ?? "");
      const bv = String(b[orderCol] ?? "");
      return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  };

  const builder: {
    select: (..._args: unknown[]) => typeof builder;
    eq: (key: string, value: unknown) => typeof builder;
    order: (column: string, opts?: { ascending?: boolean }) => typeof builder;
    single: () => Promise<{ data: Row | null; error: { message: string } | null }>;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    then: Promise<{ data: Row[]; error: null }>["then"];
  } = {
    select() {
      return builder;
    },
    eq(key, value) {
      filters.push([key, value]);
      return builder;
    },
    order(column, opts) {
      orderCol = column;
      ascending = opts?.ascending !== false;
      return builder;
    },
    async single() {
      const row = run()[0] ?? null;
      return {
        data: row,
        error: row ? null : { message: "No rows" },
      };
    },
    async maybeSingle() {
      return { data: run()[0] ?? null, error: null };
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({ data: run(), error: null as null }).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

/** Supabase-shaped client backed by the local demo accounts. */
export function createDemoClient(read: () => DemoSession | null, write?: (session: DemoSession | null) => void) {
  return {
    auth: {
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const account = DEMO_ACCOUNTS.find(
          (a) => a.email.toLowerCase() === email.trim().toLowerCase()
        );
        if (!account || account.password !== password) {
          return {
            data: { user: null, session: null },
            error: { message: "Invalid login credentials" },
          };
        }
        const session = sessionOf(account);
        write?.(session);
        const user = toAuthUser(session);
        return {
          data: {
            user,
            session: { access_token: `demo.${account.id}`, user },
          },
          error: null,
        };
      },
      async getSession() {
        const session = read();
        if (!session) return { data: { session: null }, error: null };
        const user = toAuthUser(session);
        return {
          data: { session: { access_token: `demo.${session.id}`, user } },
          error: null,
        };
      },
      async getUser() {
        const session = read();
        if (!session) return { data: { user: null }, error: null };
        return { data: { user: toAuthUser(session) }, error: null };
      },
      async signOut() {
        write?.(null);
        return { error: null };
      },
      async signInWithOAuth() {
        return {
          data: { url: null },
          error: { message: "Google sign-in needs a real Supabase project. Use a demo account." },
        };
      },
      async resend() {
        return { error: { message: "Email confirmation is not used in the local demo database." } };
      },
    },
    from(table: string) {
      return query(table);
    },
  };
}

export function createDemoBrowserClient() {
  return createDemoClient(readBrowserCookie, writeBrowserCookie);
}

export function createDemoServerClient(readCookie: (name: string) => string | undefined) {
  return createDemoClient(() => parseDemoCookie(readCookie(DEMO_COOKIE)));
}
