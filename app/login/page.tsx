export const metadata = { title: "Log in · LinkedIn Post Checker" };

export default function Login({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <main className="login">
      <form className="login-card" method="post" action="/api/login">
        <h1>LinkedIn Post Checker</h1>
        <p className="muted">Enter the portal password.</p>
        <input type="hidden" name="next" value={searchParams.next || "/"} />
        <input type="password" name="password" placeholder="Password" autoFocus required />
        {searchParams.error && <p className="error">Wrong password.</p>}
        <button className="button primary" type="submit">Log in</button>
      </form>
    </main>
  );
}
