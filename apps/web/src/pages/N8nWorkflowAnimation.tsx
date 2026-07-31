/** Animação estilo canvas n8n — fluxo webhook → IF → call-human → mensagem. */

type WorkflowNodeProps = {
  x: number;
  y: number;
  w: number;
  label: string;
  sublabel?: string;
  accent: string;
  pulseDelay: string;
};

function WorkflowNode({ x, y, w, label, sublabel, accent, pulseDelay }: WorkflowNodeProps) {
  const h = sublabel ? 50 : 42;
  const cy = y + h / 2;
  return (
    <g className="n8n-wf-node" style={{ animationDelay: pulseDelay }}>
      <rect x={x} y={y} width={w} height={h} rx={6} className="n8n-wf-node-box" stroke={accent} />
      <rect x={x + 8} y={y + 10} width={4} height={h - 20} rx={2} fill={accent} opacity={0.85} />
      <text x={x + 18} y={y + (sublabel ? 21 : 26)} className="n8n-wf-node-label">
        {label}
      </text>
      {sublabel ? (
        <text x={x + 18} y={y + 36} className="n8n-wf-node-sublabel">
          {sublabel}
        </text>
      ) : null}
      <circle cx={x} cy={cy} r={4} className="n8n-wf-port" />
      <circle cx={x + w} cy={cy} r={4} className="n8n-wf-port" />
    </g>
  );
}

function FlowLine({ d, flowDelay }: { d: string; flowDelay: string }) {
  return (
    <>
      <path d={d} className="n8n-wf-line-bg" markerEnd="url(#n8n-arrow)" />
      <path d={d} className="n8n-wf-line-flow" style={{ animationDelay: flowDelay }} />
    </>
  );
}

export function N8nWorkflowAnimation() {
  const webhookOut = "M 104 51 L 124 51";
  const ifToCall = "M 224 51 L 254 51";
  const callToMsg = "M 314 72 L 314 108";
  const ifToBot = "M 174 80 L 174 118 L 104 118";

  return (
    <div
      className="n8n-workflow-canvas relative w-full shrink-0 overflow-hidden rounded-xl border border-[#3a3d4a] bg-[#1a1d24] shadow-lg lg:max-w-[420px] print:hidden"
      aria-hidden
    >
      <div className="flex items-center gap-2 border-b border-[#3a3d4a] px-3 py-2">
        <span className="size-2 rounded-full bg-[#EA4B71]" />
        <span className="text-[10px] font-medium tracking-wide text-[#888]">Workflow — OpenNexo handoff</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="n8n-wf-status-dot size-1.5 rounded-full bg-emerald-400" />
          <span className="text-[9px] text-emerald-400/80">Active</span>
        </span>
      </div>

      <svg viewBox="0 0 380 168" className="w-full px-1 py-3" role="img" aria-label="Fluxo n8n animado">
        <defs>
          <marker id="n8n-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#EA4B71" opacity={0.9} />
          </marker>
        </defs>

        <FlowLine d={webhookOut} flowDelay="0s" />
        <FlowLine d={ifToCall} flowDelay="0.35s" />
        <FlowLine d={callToMsg} flowDelay="0.7s" />
        <FlowLine d={ifToBot} flowDelay="1.05s" />

        <WorkflowNode x={0} y={28} w={104} label="Webhook" sublabel="message_created" accent="#10B981" pulseDelay="0s" />
        <WorkflowNode x={124} y={28} w={100} label="IF" sublabel="escalar?" accent="#F59E0B" pulseDelay="1.75s" />
        <WorkflowNode x={254} y={28} w={120} label="HTTP Request" sublabel="call-human" accent="#EA4B71" pulseDelay="3.5s" />
        <WorkflowNode x={254} y={108} w={120} label="HTTP Request" sublabel="mensagem CRM" accent="#EA4B71" pulseDelay="5.25s" />
        <WorkflowNode x={0} y={96} w={104} label="HTTP Request" sublabel="resposta bot" accent="#6366F1" pulseDelay="7s" />

        {/* Pacote percorrendo o fluxo principal */}
        <circle r={3.5} fill="#EA4B71" opacity={0}>
          <animate attributeName="opacity" values="0;1;1;1;0" keyTimes="0;0.05;0.9;0.95;1" dur="7s" repeatCount="indefinite" />
          <animateMotion dur="7s" repeatCount="indefinite" path="M 104 51 L 224 51 L 314 51 L 314 108" />
        </circle>

        {/* Pacote no ramo alternativo */}
        <circle r={3} fill="#6366F1" opacity={0}>
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.45;0.5;0.9;1" dur="7s" repeatCount="indefinite" />
          <animateMotion dur="7s" repeatCount="indefinite" begin="3.2s" path="M 174 80 L 174 118 L 104 118" />
        </circle>
      </svg>

      <p className="border-t border-[#3a3d4a] px-3 py-2 text-center text-[10px] text-[#666]">
        Webhook → decisão → handoff → mensagem opcional
      </p>
    </div>
  );
}
