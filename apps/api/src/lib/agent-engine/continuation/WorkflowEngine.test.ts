import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import {
  clearWorkflowStoreForTests,
  compensateWorkflow,
  parseWorkflowDefinition,
  resumeWorkflow,
  startWorkflow,
  type WorkflowDefinition,
} from "./index.js";

beforeEach(() => {
  clearWorkflowStoreForTests();
});

function hotelishCheckInWorkflow(): WorkflowDefinition {
  const raw = {
    version: 1,
    id: "checkin_flow",
    entry: "need_reservation",
    steps: {
      need_reservation: {
        kind: "branch",
        when: { var: "reservation.code", truthy: true },
        then: "consult",
        else: "ask_code",
      },
      ask_code: {
        kind: "suspend",
        suspendReason: "need_reservation_code",
        resumeOn: "next_message",
        next: "set_code",
      },
      set_code: {
        kind: "set_var",
        varName: "reservation.code",
        varValue: "__from_resume__",
        next: "consult",
      },
      consult: {
        kind: "tool",
        toolName: "audaar_consultar_reserva",
        compensateWith: "undo_consult_marker",
        next: "confirm_gate",
      },
      undo_consult_marker: {
        kind: "set_var",
        varName: "compensated.consult",
        varValue: true,
      },
      confirm_gate: {
        kind: "suspend",
        suspendReason: "await_guest_confirm",
        resumeOn: "next_message",
        next: "done",
      },
      done: {
        kind: "set_var",
        varName: "phase",
        varValue: "complete",
      },
    },
  };
  const def = parseWorkflowDefinition(raw);
  assert.ok(def);
  return def;
}

describe("parseWorkflowDefinition", () => {
  test("rejects missing entry step", () => {
    assert.equal(
      parseWorkflowDefinition({ id: "x", entry: "missing", steps: { a: { kind: "noop" } } }),
      null,
    );
  });

  test("parses valid definition", () => {
    const def = hotelishCheckInWorkflow();
    assert.equal(def.id, "checkin_flow");
    assert.equal(def.steps.consult.toolName, "audaar_consultar_reserva");
  });
});

describe("WorkflowEngine branch + suspend + resume", () => {
  test("branches to suspend when reservation missing", async () => {
    const def = hotelishCheckInWorkflow();
    const { state, done } = await startWorkflow({
      definition: def,
      vars: {},
      persist: false,
    });
    assert.equal(done, true);
    assert.equal(state.status, "suspended");
    assert.equal(state.suspendReason, "need_reservation_code");
    assert.equal(state.currentStepId, "ask_code");
  });

  test("consults tool when reservation present then suspends on confirm", async () => {
    const def = hotelishCheckInWorkflow();
    const calls: string[] = [];
    const { state } = await startWorkflow({
      definition: def,
      vars: { reservation: { code: "HVW4V2D5" } },
      persist: false,
      handlers: {
        onTool: async (step) => {
          calls.push(step.toolName!);
          return { ok: true, result: { ok: true } };
        },
      },
    });
    assert.deepEqual(calls, ["audaar_consultar_reserva"]);
    assert.equal(state.status, "suspended");
    assert.equal(state.suspendReason, "await_guest_confirm");
    assert.deepEqual(state.plannedToolNames, ["audaar_consultar_reserva"]);
    assert.ok(state.compensationStack.includes("undo_consult_marker"));
  });

  test("resume after suspend completes flow", async () => {
    const def = hotelishCheckInWorkflow();
    const first = await startWorkflow({
      definition: def,
      vars: { reservation: { code: "ABC" } },
      persist: false,
      handlers: { onTool: async () => ({ ok: true }) },
    });
    assert.equal(first.state.status, "suspended");

    const second = await resumeWorkflow(def, first.state, {
      vars: { guestConfirmed: true },
      persist: false,
    });
    assert.equal(second.state.status, "completed");
    assert.equal(second.state.vars.phase, "complete");
    assert.equal(second.state.vars.guestConfirmed, true);
  });
});

describe("WorkflowEngine loop", () => {
  test("loops until condition or max", async () => {
    const def = parseWorkflowDefinition({
      id: "retry_loop",
      entry: "loop",
      steps: {
        loop: {
          kind: "loop",
          body: "bump",
          until: { var: "n", eq: 3 },
          maxIterations: 10,
          next: "end",
        },
        bump: {
          kind: "noop",
        },
        end: {
          kind: "set_var",
          varName: "done",
          varValue: true,
        },
      },
    });
    assert.ok(def);

    // until n===3 never true without set_var — hits maxIterations
    const { state } = await startWorkflow({ definition: def, vars: { n: 0 }, persist: false });
    assert.equal(state.status, "completed");
    assert.equal(state.iterationCounts.loop, 10);
    assert.equal(state.vars.done, true);
  });

  test("loop exits when until satisfied via body set_var", async () => {
    const def = parseWorkflowDefinition({
      id: "fill_loop",
      entry: "loop",
      steps: {
        loop: {
          kind: "loop",
          body: "inc",
          until: { var: "n", eq: 2 },
          maxIterations: 5,
          next: "end",
        },
        inc: {
          kind: "set_var",
          varName: "n",
          varValue: 2,
        },
        end: { kind: "noop" },
      },
    });
    assert.ok(def);
    const { state } = await startWorkflow({ definition: def, vars: { n: 0 }, persist: false });
    assert.equal(state.status, "completed");
    assert.ok((state.iterationCounts.loop ?? 0) <= 2);
  });
});

describe("WorkflowEngine compensation", () => {
  test("runs compensate stack LIFO on tool failure", async () => {
    const def = parseWorkflowDefinition({
      id: "saga",
      entry: "a",
      steps: {
        a: {
          kind: "set_var",
          varName: "a",
          varValue: 1,
          compensateWith: "undo_a",
          next: "b",
        },
        undo_a: {
          kind: "set_var",
          varName: "undid_a",
          varValue: true,
        },
        b: {
          kind: "tool",
          toolName: "fail_me",
          compensateWith: "undo_b",
          next: "c",
        },
        undo_b: {
          kind: "set_var",
          varName: "undid_b",
          varValue: true,
        },
        c: { kind: "noop" },
      },
    });
    assert.ok(def);
    const { state } = await startWorkflow({
      definition: def,
      persist: false,
      handlers: {
        onTool: async () => ({ ok: false, error: "boom" }),
      },
    });
    assert.equal(state.status, "compensated");
    assert.equal(state.vars.undid_a, true);
    // undo_b only pushed if b succeeded — b failed so only undo_a
    assert.equal(state.vars.undid_b, undefined);
    assert.match(state.error ?? "", /boom|tool_failed/);
  });

  test("manual compensateWorkflow drains stack", async () => {
    const def = hotelishCheckInWorkflow();
    const started = await startWorkflow({
      definition: def,
      vars: { reservation: { code: "X" } },
      persist: false,
      handlers: { onTool: async () => ({ ok: true }) },
    });
    assert.ok(started.state.compensationStack.length > 0);
    const done = await compensateWorkflow(def, started.state, undefined, false);
    assert.equal(done.status, "compensated");
    assert.equal(done.vars["compensated.consult"], true);
  });
});
