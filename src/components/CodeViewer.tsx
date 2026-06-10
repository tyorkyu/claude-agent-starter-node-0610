import type React from 'react';
import styles from './CodeViewer.module.css';

/* -- Tiny inline helpers -- */
const Cmt  = ({ t }: { t: string }) => <span className={styles.cmt}>{t}</span>;
const Kw   = ({ t }: { t: string }) => <span className={styles.kw}>{t}</span>;
const Fn   = ({ t }: { t: string }) => <span className={styles.fn}>{t}</span>;
const Str  = ({ t }: { t: string }) => <span className={styles.str}>{t}</span>;
const Doc  = ({ t }: { t: string }) => <span className={styles.doc}>{t}</span>;
const Op   = ({ t }: { t: string }) => <span className={styles.op}>{t}</span>;
const Va   = ({ t }: { t: string }) => <span className={styles.va}>{t}</span>;

interface LineProps { n: number; children?: React.ReactNode }
const L = ({ n, children }: LineProps) => (
  <div className={styles.line}>
    <span className={styles.ln}>{String(n).padStart(2, ' ')}</span>
    <span className={styles.lc}>{children ?? ' '}</span>
  </div>
);

const I = ({ level = 1 }: { level?: number }) => (
  <>{Array.from({ length: level }).map((_, i) => (
    <span key={i} className={styles.indent} />
  ))}</>
);

export default function CodeViewer() {
  return (
    <div className={styles.panel}>
      {/* -- Header -- */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileIcon}>&#x2B21;</span>
          <span className={styles.filename}>agent<span className={styles.sep}>.</span>ts</span>
        </div>
        <span className={styles.badge}>READ ONLY</span>
      </div>

      {/* -- Code body -- */}
      <div className={styles.body}>
        <div className={styles.scanline} aria-hidden />

        <div className={styles.code}>
          <L n={1}>
            <Kw t="import " /><Op t="{ " />
            <Va t="query" /><Op t=", " />
            <Va t="createSdkMcpServer" />
            <Op t=" } " /><Kw t="from " /><Str t="'claude-agent-sdk'" />
          </L>
          <L n={2} />

          <L n={3}>
            <Kw t="const " /><Va t="SYSTEM_PROMPT" /><Op t=" = " />
            <Str t="`...`" />
          </L>
          <L n={4} />

          <L n={5}>
            <Kw t="export async function " /><Fn t="onRequest" /><Op t="(" />
            <Va t="context" /><Op t=") {" />
          </L>
          <L n={6}>
            <I /><Kw t="const " /><Va t="message" /><Op t=" = " />
            <Va t="context" /><Op t="." /><Va t="request" /><Op t="." /><Va t="body" />
            <Op t="?." /><Va t="message" /><Op t=" ?? " /><Str t="''" />
          </L>
          <L n={7}>
            <I /><Kw t="const " /><Va t="conversationId" /><Op t=" = " />
            <Va t="context" /><Op t="." /><Va t="conversation_id" />
          </L>
          <L n={8}>
            <I /><Kw t="const " /><Va t="store" /><Op t=" = " />
            <Va t="context" /><Op t="." /><Va t="store" />
          </L>
          <L n={9} />

          {/* Step 1 */}
          <L n={10}>
            <I /><Cmt t="// 1. EdgeOne Store: save user message for history restore" />
          </L>
          <L n={11}>
            <I /><Kw t="await " /><Va t="store" /><Op t="?." />
            <Fn t="appendMessage" /><Op t="?.({" />
          </L>
          <L n={12}>
            <I level={2} /><Va t="conversationId" /><Op t="," />
          </L>
          <L n={13}>
            <I level={2} /><Va t="role" /><Op t=": " /><Str t="'user'" /><Op t="," />
          </L>
          <L n={14}>
            <I level={2} /><Va t="content" /><Op t=": " /><Va t="message" />
          </L>
          <L n={15}>
            <I /><Op t="})" />
          </L>
          <L n={16} />

          {/* Step 2 */}
          <L n={17}>
            <I /><Cmt t="// 2. EdgeOne Store: inject Claude Agent SDK session memory" />
          </L>
          <L n={18}>
            <I /><Kw t="const " /><Va t="sessionStore" /><Op t=" = " />
            <Va t="store" /><Op t="?." />
            <Fn t="claude_session_store" /><Op t="?.()" />
          </L>
          <L n={19} />

          {/* Step 3 */}
          <L n={20}>
            <I /><Cmt t="// 3. EdgeOne Tools: one-click convert to Claude MCP Server" />
          </L>
          <L n={21}>
            <I /><Kw t="const " /><Va t="edgeoneMcp" /><Op t=" = " />
            <Va t="context" /><Op t="." /><Va t="tools" /><Op t="." />
            <Fn t="toClaudeMcpServer" /><Op t="()" />
          </L>
          <L n={22}>
            <I /><Kw t="const " /><Va t="mcpServer" /><Op t=" = " />
            <Fn t="createSdkMcpServer" /><Op t="({" />
          </L>
          <L n={23}>
            <I level={2} /><Va t="name" /><Op t=": " />
            <Va t="edgeoneMcp" /><Op t="." /><Va t="name" /><Op t="," />
          </L>
          <L n={24}>
            <I level={2} /><Va t="tools" /><Op t=": " />
            <Va t="edgeoneMcp" /><Op t="." /><Va t="tools" /><Op t="," />
          </L>
          <L n={25}>
            <I level={2} /><Va t="alwaysLoad" /><Op t=": " /><Kw t="true" />
          </L>
          <L n={26}>
            <I /><Op t="})" />
          </L>
          <L n={27} />

          {/* Step 4 */}
          <L n={28}>
            <I /><Cmt t="// 4. Build Agent run options" />
          </L>
          <L n={29}>
            <I /><Kw t="const " /><Va t="options" /><Op t=" = {" />
          </L>
          <L n={30}>
            <I level={2} /><Va t="model" /><Op t=": " />
            <Va t="context" /><Op t="." /><Va t="env" /><Op t="." />
            <Va t="AI_GATEWAY_MODEL" /><Op t="," />
          </L>
          <L n={31}>
            <I level={2} /><Va t="systemPrompt" /><Op t=": " />
            <Va t="SYSTEM_PROMPT" /><Op t="," />
          </L>
          <L n={32}>
            <I level={2} /><Va t="sessionStore" /><Op t="," />
          </L>
          <L n={33}>
            <I level={2} /><Va t="mcpServers" /><Op t=": { [" />
            <Va t="edgeoneMcp" /><Op t="." /><Va t="name" /><Op t="]: " />
            <Va t="mcpServer" /><Op t=" }," />
          </L>
          <L n={34}>
            <I level={2} /><Va t="allowedTools" /><Op t=": " />
            <Va t="edgeoneMcp" /><Op t="." /><Va t="allowedTools" /><Op t="," />
          </L>
          <L n={35}>
            <I level={2} /><Va t="permissionMode" /><Op t=": " />
            <Str t="'bypassPermissions'" /><Op t="," />
          </L>
          <L n={36}>
            <I level={2} /><Va t="maxTurns" /><Op t=": " />
            <Va t="10" /><Op t="," />
          </L>
          <L n={37}>
            <I level={2} /><Va t="env" /><Op t=": { ..." />
            <Va t="context" /><Op t="." /><Va t="env" /><Op t=" }," />
          </L>
          <L n={38}>
            <I /><Op t="}" />
          </L>
          <L n={39} />

          {/* Step 5 */}
          <L n={40}>
            <I /><Cmt t="// 5. Launch Claude Agent" />
          </L>
          <L n={41}>
            <I /><Kw t="const " /><Va t="result" /><Op t=" = " />
            <Fn t="query" /><Op t="({ " />
            <Va t="prompt" /><Op t=": " /><Va t="message" /><Op t=", " />
            <Va t="options" /><Op t=" })" />
          </L>
          <L n={42} />

          <L n={43}>
            <I /><Doc t="// SSE streaming details omitted..." />
          </L>
          <L n={44}>
            <I /><Kw t="const " /><Va t="assistantText" /><Op t=" = " />
            <Kw t="await " /><Fn t="collectText" /><Op t="(" /><Va t="result" /><Op t=")" />
          </L>
          <L n={45} />

          {/* Step 6 */}
          <L n={46}>
            <I /><Cmt t="// 6. EdgeOne Store: save assistant reply for /history restore" />
          </L>
          <L n={47}>
            <I /><Kw t="await " /><Va t="store" /><Op t="?." />
            <Fn t="appendMessage" /><Op t="?.({" />
          </L>
          <L n={48}>
            <I level={2} /><Va t="conversationId" /><Op t="," />
          </L>
          <L n={49}>
            <I level={2} /><Va t="role" /><Op t=": " /><Str t="'assistant'" /><Op t="," />
          </L>
          <L n={50}>
            <I level={2} /><Va t="content" /><Op t=": " /><Va t="assistantText" />
          </L>
          <L n={51}>
            <I /><Op t="})" />
          </L>
          <L n={52} />

          <L n={53}>
            <I /><Kw t="return " />
            <Va t="Response" /><Op t="." /><Fn t="json" /><Op t="({ " />
            <Va t="answer" /><Op t=": " /><Va t="assistantText" /><Op t=" })" />
          </L>
          <L n={54}><Op t="}" /></L>
        </div>
      </div>

      {/* -- Footer tag -- */}
      <div className={styles.footer}>
        <span className={styles.footerDot} />
        <span>EdgeOne Store · MCP Tools · Claude Agent SDK</span>
      </div>
    </div>
  );
}
