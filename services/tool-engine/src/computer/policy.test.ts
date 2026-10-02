import { test } from "node:test";
import assert from "node:assert/strict";
import { appBlock, keyApproval, labelApproval, secretField } from "./policy.ts";

test("never controls terminals, password managers, system settings, or agents", () => {
  const blocked: Array<[string, string]> = [
    ["com.apple.Terminal", "Terminal"],
    ["com.googlecode.iterm2", "iTerm2"],
    ["com.mitchellh.ghostty", "Ghostty"],
    ["com.apple.keychainaccess", "Keychain Access"],
    ["com.apple.Passwords", "Passwords"],
    ["com.1password.1password", "1Password"],
    ["com.apple.systempreferences", "System Settings"],
    ["com.nousresearch.hermes", "Hermes"],
    ["com.trycua.driver", "Cua Driver"],
  ];
  for (const [bundle, name] of blocked) assert.match(appBlock(bundle, name) ?? "", /never/i, bundle);
});

test("ordinary apps are not blocked", () => {
  for (const [b, n] of [["com.apple.TextEdit", "TextEdit"], ["com.apple.Safari", "Safari"], ["com.apple.mail", "Mail"]]) {
    assert.equal(appBlock(b, n), undefined);
  }
});

test("an app whose bundle is unknown is blocked", () => {
  assert.match(appBlock(undefined, "Mystery") ?? "", /never/i);
});

test("labels that send, buy, delete, or change an account need approval", () => {
  for (const label of ["Send", "Send Message", "Submit", "Buy Now", "Place Order", "Pay $20", "Delete", "Move to Trash", "Empty Trash", "Sign Out", "Publish", "Quit Mail", "Reset Password", "Remove account"]) {
    assert.ok(labelApproval(label, "AXButton"), label);
  }
});

test("harmless labels do not", () => {
  for (const label of ["Search", "Bold", "Open", "Save", "Cancel", "Next", "Back", "Sender", "Compose"]) {
    assert.equal(labelApproval(label, "AXButton"), undefined, label);
  }
});

test("an unlabeled button needs approval, an unlabeled text area does not", () => {
  assert.ok(labelApproval(undefined, "AXButton"));
  assert.ok(labelApproval("", "AXButton"));
  assert.equal(labelApproval(undefined, "AXTextArea"), undefined);
  assert.equal(labelApproval(undefined, "AXStaticText"), undefined);
});

test("Return, Delete, Quit, Spotlight and force-quit keys need approval", () => {
  for (const keys of [["return"], ["enter"], ["cmd", "return"], ["delete"], ["cmd", "delete"], ["backspace"], ["forwarddelete"], ["cmd", "q"], ["cmd", "space"], ["cmd", "option", "escape"]]) {
    assert.ok(keyApproval(keys, false), keys.join("+"));
  }
});

test("Return is fine straight after typing in a search or address field", () => {
  assert.equal(keyApproval(["return"], true), undefined);
  assert.ok(keyApproval(["cmd", "return"], true)); // cmd+return still sends mail
  assert.ok(keyApproval(["delete"], true));
});

test("ordinary keys do not need approval", () => {
  for (const keys of [["tab"], ["cmd", "c"], ["cmd", "v"], ["cmd", "a"], ["down"], ["escape"], ["cmd", "w"], ["cmd", "s"]]) {
    assert.equal(keyApproval(keys, false), undefined, keys.join("+"));
  }
});

test("secret fields are recognised by role or by label", () => {
  assert.ok(secretField({ role: "AXSecureTextField" }));
  for (const label of ["Password", "Confirm password", "Passcode", "PIN", "One-time code (OTP)", "CVV", "Card number", "Security code"]) {
    assert.ok(secretField({ role: "AXTextField", label }), label);
  }
  assert.equal(secretField({ role: "AXTextField", label: "Search" }), undefined);
  assert.equal(secretField({ role: "AXTextArea", label: "Notes" }), undefined);
  assert.equal(secretField({ role: "AXTextField", label: "Spinning wheel" }), undefined);
});

test("document text is not a button: a text area whose content says \"buy milk\" does not need approval", () => {
  assert.equal(labelApproval("buy milk, send the report", "AXTextArea"), undefined);
  assert.equal(labelApproval("Delete everything", "AXStaticText"), undefined);
  assert.equal(labelApproval("Delete everything", "AXTextField"), undefined);
  assert.ok(labelApproval("Delete", "AXButton"));
  assert.ok(labelApproval("Send", "AXLink"));
  assert.ok(labelApproval("Delete", "AXMenuItem"));
  assert.ok(labelApproval("Pay now", "AXCheckBox"));
  assert.ok(labelApproval("Buy", "AXGroup")); // unknown roles still ask
});

test("a long label is cut in the approval wording", () => {
  const why = labelApproval("Send " + "x".repeat(300), "AXButton")!;
  assert.ok(why.length < 80);
});
