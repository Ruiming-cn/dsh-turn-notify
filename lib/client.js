window.__ModuleLoader__.load({ id: 'dsh-turn-notify', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/locales.ts
var NS = "turn-notify";
var zh = {
  nav: "\u8F6E\u6B21\u63D0\u9192",
  title: "\u8F6E\u6B21\u63D0\u9192",
  description: "\u7528 Windows \u901A\u77E5\u63D0\u9192\u4F60\uFF1AAgent \u505C\u4E0B\u6765\u7B49\u4F60\u65F6\uFF0C\u4EE5\u53CA\u8F6E\u6B21\u7ED3\u675F\u65F6\u3002\u6539\u52A8\u5BF9\u4E0B\u4E00\u6761\u901A\u77E5\u7ACB\u5373\u751F\u6548\u3002",
  needsInput: "\u9700\u8981\u4F60\u4ECB\u5165\u65F6",
  needsInputHint: "\u7B49\u5F85\u6279\u51C6\u3001\u7B49\u5F85\u56DE\u7B54\u3001\u8BA1\u5212\u5F85\u5BA1\u9605\u3002",
  turnCompleted: "\u8F6E\u6B21\u5B8C\u6210\u65F6",
  turnCompletedHint: "\u4F60\u53D1\u8D77\u7684\u8F6E\u6B21\u7ED9\u51FA\u4E86\u56DE\u7B54\u3002",
  turnProblems: "\u8F6E\u6B21\u5F02\u5E38\u7ED3\u675F\u65F6",
  turnProblemsHint: "\u51FA\u9519\u3001\u4E2D\u6B62\u3001\u963B\u585E\u3001\u8F93\u51FA\u8D85\u9650\u6216\u4F1A\u8BDD\u4E2D\u65AD\u3002",
  sound: "\u64AD\u653E\u63D0\u793A\u97F3",
  soundHint: "\u4F7F\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u901A\u77E5\u97F3\u3002",
  loading: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026",
  missing: "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u3002",
  readOnly: "\u672C\u90E8\u7F72\u7684\u63D2\u4EF6\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002"
};
var en = {
  nav: "Turn notifications",
  title: "Turn notifications",
  description: "Windows toasts for the moments the agent waits on you and the moments a turn ends. Changes apply to the next notification.",
  needsInput: "When I am needed",
  needsInputHint: "Waiting for approval, an answer, or plan review.",
  turnCompleted: "When a turn completes",
  turnCompletedHint: "A turn you asked for has answered.",
  turnProblems: "When a turn ends badly",
  turnProblemsHint: "Error, abort, block, output limit or interruption.",
  sound: "Play a sound",
  soundHint: "Uses the default Windows notification sound.",
  loading: "Reading settings\u2026",
  missing: "This plugin is not loaded, so it cannot be configured right now.",
  readOnly: "This deployment stores plugin settings read-only."
};

// src/client/settings-view.tsx
var import_react = require("react");

// src/client/namespace.ts
var SETTING_FIELDS = ["needsInput", "turnCompleted", "turnProblems", "sound"];
function pickNamespace(namespaces) {
  if (!Array.isArray(namespaces)) return void 0;
  for (const candidate of namespaces) {
    const view = candidate;
    if (typeof view?.ns !== "string" || view.ns === "") continue;
    if (declaresEveryField(view.schema)) return view.ns;
  }
  return void 0;
}
function declaresEveryField(schema) {
  if (schema === void 0 || schema === null) return false;
  let text;
  try {
    text = JSON.stringify(schema);
  } catch {
    return false;
  }
  return SETTING_FIELDS.every((field) => text.includes(`"${field}"`));
}

// src/client/settings-view.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var SWITCHES = [
  { field: "needsInput", label: "needsInput", hint: "needsInputHint" },
  { field: "turnCompleted", label: "turnCompleted", hint: "turnCompletedHint" },
  { field: "turnProblems", label: "turnProblems", hint: "turnProblemsHint" },
  { field: "sound", label: "sound", hint: "soundHint" }
];
var styles = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "4px 0",
    color: "var(--dsw-alias-label-primary, #1f1f1f)",
    font: "inherit"
  },
  title: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 600 },
  description: { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary, #555)" },
  note: { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-tertiary, #8a8a8e)" },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    padding: "10px 12px",
    border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))",
    borderRadius: "10px",
    cursor: "pointer"
  },
  control: { marginTop: "2px", flex: "none" },
  body: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  label: { fontSize: "13px", lineHeight: "20px", fontWeight: 500 },
  hint: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #8a8a8e)" }
};
function NotifySection({ forms, t }) {
  const describe = forms.describe();
  const subscribeMirror = (0, import_react.useCallback)((listener) => describe.subscribe(listener), [describe]);
  const readMirror = (0, import_react.useCallback)(() => describe.getSnapshot(), [describe]);
  const mirror = (0, import_react.useSyncExternalStore)(subscribeMirror, readMirror);
  const namespaces = mirror?.view?.namespaces;
  if (namespaces === void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.note, children: t("loading") });
  const namespace = pickNamespace(namespaces);
  if (namespace === void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.note, children: t("missing") });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SwitchList, { forms, namespace, t });
}
function SwitchList({ forms, namespace, t }) {
  const form = forms.get(namespace);
  const subscribe = (0, import_react.useCallback)((listener) => form.subscribe(listener), [form]);
  const read = (0, import_react.useCallback)(() => form.getSnapshot(), [form]);
  const snapshot = (0, import_react.useSyncExternalStore)(subscribe, read);
  const writable = snapshot.writable !== false;
  const values = typeof snapshot.value === "object" && snapshot.value !== null ? snapshot.value : {};
  const disabled = !writable || snapshot.status === "unavailable";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.section, "aria-label": t("title"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t("title") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.description, children: t("description") }),
    writable ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.note, children: t("readOnly") }),
    !writable || snapshot.status !== "unavailable" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.note, children: t("missing") }),
    SWITCHES.map(({ field, label, hint }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.row, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "checkbox",
          role: "switch",
          style: styles.control,
          checked: values[field] !== false,
          disabled,
          "aria-label": t(label),
          onChange: (event) => {
            void form.set(field, event.currentTarget.checked);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.body, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: t(label) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: t(hint) })
      ] })
    ] }, field))
  ] });
}

// src/client/index.ts
var inject = ["slots", "locale"];
function asDisposer(value) {
  if (typeof value === "function") return value;
  const disposable = value;
  return () => {
    disposable?.dispose?.();
  };
}
function apply(ctx) {
  const client = ctx;
  client.effect(() => client.locale.register(NS, { zh, en }), "dsh-turn-notify: dictionaries");
  const t = client.locale.bind(NS);
  const slots = client.slots;
  if (slots === void 0) return;
  client.inject(["configForms"], (child) => {
    const forms = child.get("configForms");
    if (forms === void 0) return;
    child.effect(
      () => asDisposer(
        slots.inject(
          "settings.section",
          () => slots.register(
            {
              name: "settings.section",
              id: "dsh-turn-notify",
              order: 870,
              locale: NS,
              label: () => t("nav"),
              inject: () => ({ forms, t })
            },
            NotifySection
          )
        )
      ),
      "dsh-turn-notify: settings section"
    );
  });
}
return module.exports; } });
//# sourceMappingURL=client.js.map
