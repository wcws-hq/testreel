import type { AppKind, Triage } from "../../src/shared/types.ts";
import { Section } from "./common.tsx";

const KIND_LABEL: Record<AppKind, string> = { web: "Web app", cli: "Command line tool", api: "API server", library: "Library", other: "Other" };

function Commands({ label, commands }: { label: string; commands: string[] }) {
  return (
    <div className="triage-block">
      <h3 className="mini-title">{label}</h3>
      <pre className="triage-cmds">{commands.join("\n")}</pre>
    </div>
  );
}

export function TriageCard({ triage }: { triage: Triage }) {
  const start = triage.start ? [triage.start] : [];
  return (
    <Section
      title="What Testreel will try"
      aside={
        <>
          <span className="pill">{KIND_LABEL[triage.kind]}</span>
          {triage.port ? <span className="pill mono tnum">:{triage.port}</span> : null}
          {triage.testCommand ? <span className="pill">Has its own tests</span> : null}
        </>
      }
    >
      <p className="triage-summary">{triage.summary}</p>
      <div className="triage-grid">
        {triage.flows.length > 0 ? (
          <div className="triage-block">
            <h3 className="mini-title">{triage.kind === "cli" ? "Commands to try" : "Things to try"}</h3>
            <ol className="triage-flows">
              {triage.flows.map(flow => (
                <li key={flow}>{flow}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {triage.install.length > 0 ? <Commands label="Install" commands={triage.install} /> : null}
        {start.length > 0 ? <Commands label={triage.healthPath ? `Start, checked at ${triage.healthPath}` : "Start"} commands={start} /> : null}
        {triage.testCommand ? <Commands label="Its own tests" commands={[triage.testCommand]} /> : null}
      </div>
    </Section>
  );
}
