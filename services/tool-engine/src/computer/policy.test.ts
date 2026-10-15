import { test } from "node:test";
import assert from "node:assert/strict";
import { appBlock, isSearchField, keyApproval, labelApproval, normalizeLabel, secretField, typeApproval } from "./policy.ts";

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
    ["com.zeno.island", "old ATOM app"],
    ["dev.zeno.island", "old ATOM app"],
    ["dev.atom.island", "ATOM app"],
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
  assert.equal(labelApproval(undefined, "AXStaticText"), undefined, "unnamed static text is only text");
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
  // 2026-10-15: a page can make static text, an image or a heading clickable, so a risky name on them asks like a button.
  assert.ok(labelApproval("Delete everything", "AXStaticText"));
  assert.ok(labelApproval("Delete account", "AXImage"));
  assert.ok(labelApproval("Pay now", "AXHeading"));
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

test("the risky-word list covers consent and sign-in buttons", () => {
  for (const label of ["Allow", "Accept all", "I agree", "Authorize", "Approve", "Grant access", "Unlock", "Yes", "Continue", "Sign in", "Log in"]) {
    assert.ok(labelApproval(label, "AXButton"), label);
  }
  assert.equal(labelApproval("Bold", "AXButton"), undefined);
});

test("key aliases mean the same as the key they name", () => {
  assert.ok(keyApproval(["command", "q"], false), "Quit");
  assert.ok(keyApproval(["super", "space"], false), "Spotlight");
  assert.ok(keyApproval(["command", "alt", "esc"], false), "Force Quit");
  assert.ok(keyApproval(["kp_enter"], false), "Enter");
  assert.equal(keyApproval(["kp_enter"], true), undefined, "after typing in a search field");
});

test("a search or address field is told apart from a compose box, and a line break in typed text asks", () => {
  assert.equal(isSearchField("Search", "AXTextField"), true);
  assert.equal(isSearchField("", "AXSearchField"), true);
  assert.equal(isSearchField("Address and Search", "AXTextField"), true);
  assert.equal(isSearchField("Message", "AXTextArea"), false);
  assert.equal(isSearchField(undefined, undefined), false);
  assert.ok(typeApproval("hi\nthere"));
  assert.ok(typeApproval("hi\r"));
  assert.equal(typeApproval("hello"), undefined);
});

// 2026-10-16 (review): isSearchField matched a word ANYWHERE in the label, so "Email address", "Shipping address" or "Message #search-help"
// let Return send with no card. It now matches only a label that starts with the word.
test("Return after typing is free only in a field whose label starts with search, find, filter, address, url, location or go to", () => {
  for (const label of ["Search", "Search Google or type a URL", "Address and search bar", "URL"]) assert.equal(isSearchField(label, "AXTextField"), true, label);
  for (const label of ["Email address", "Shipping address", "Message #search-help", "Reply to find-a-friend", "Compose", "Message", "Subject", "Home location notes", "Find in page", "Filter", "Location", "Go to"]) assert.equal(isSearchField(label, "AXTextField"), false, label);
});

// 2026-10-16 (review): the words added for consent buttons made "Continue reading", "Yes, I'm interested" and "Grant Smith" ask when they were
// text, an image or a heading. Those roles now ask only for the strong action words; buttons keep the full list.
test("static text, images and headings ask only for strong action words; buttons ask for the whole list", () => {
  for (const role of ["AXStaticText", "AXImage", "AXHeading"]) {
    for (const label of ["Continue reading", "Yes, I'm interested", "Grant Smith", "Allow me to explain", "Accept the terms of the story"]) assert.equal(labelApproval(label, role), undefined, `${role} ${label}`);
    for (const label of ["Delete account", "Pay now", "Place order", "Send message", "Confirm purchase"]) assert.ok(labelApproval(label, role), `${role} ${label}`);
  }
  for (const label of ["Continue", "Allow", "Yes", "Grant access"]) assert.ok(labelApproval(label, "AXButton"), `button ${label}`);
});

// 2026-10-16 (code check, third review pass).
test("the Space key activates the focused button, so it asks like Return; Spotlight (cmd+space) still says so", () => {
  assert.ok(keyApproval(["space"], false), "plain space");
  assert.ok(keyApproval([" "], false), "a space written as the character");
  assert.match(keyApproval(["cmd", "space"], false) ?? "", /Spotlight/);
  assert.equal(keyApproval(["space"], true), undefined, "straight after typing in a search field, like Return");
});

test("only a search or address box frees Return: 'Address line 1', 'Location', 'Filter by' and 'Find' do not", () => {
  for (const label of ["Search", "Search or enter address", "Address and search bar", "Smart Search field", "Address bar", "URL"]) assert.equal(isSearchField(label, "AXTextField"), true, label);
  for (const label of ["Address line 1", "Shipping address", "Location", "Filter by tag", "Find a friend", "Go to checkout", "Message"]) assert.equal(isSearchField(label, "AXTextField"), false, label);
  assert.equal(isSearchField("anything", "AXSearchField"), true, "the search role");
});

test("labels are read after normalisation: fullwidth, zero-width, camelCase and underscores no longer hide a risky word", () => {
  assert.equal(normalizeLabel("Ｓｅｎｄ"), "Send");
  assert.equal(normalizeLabel("Se\u200bnd"), "Send");
  assert.equal(normalizeLabel("SendEmail"), "Send Email");
  assert.equal(normalizeLabel("Send_now"), "Send now");
  for (const label of ["Ｓｅｎｄ", "Se\u200bnd", "SendEmail", "Send_now", "ＤＥＬＥＴＥ account"]) assert.ok(labelApproval(label, "AXButton"), label);
});

test("buttons that confirm a dialog or hand something over ask: OK, Reply, Forward, Sign up, Register, Upload, Overwrite, Discard", () => {
  for (const label of ["OK", "Reply", "Forward", "Sign up", "Register", "Upload", "Overwrite", "Discard", "Book now", "Reserve"]) assert.ok(labelApproval(label, "AXButton"), label);
  assert.equal(labelApproval("Okay then, tell me more", "AXStaticText"), undefined, "plain text still asks only for strong words");
  assert.equal(labelApproval("Bold", "AXButton"), undefined);
  for (const label of ["Save", "Done", "Open", "Cancel", "Next"]) assert.equal(labelApproval(label, "AXButton"), undefined, `${label} stays harmless`);
});

test("scripting, automation and editor apps with a terminal are never controlled", () => {
  for (const [id, name] of [["com.apple.ScriptEditor2", "Script Editor"], ["com.apple.Automator", "Automator"], ["com.apple.shortcuts", "Shortcuts"], ["com.raycast.macos", "Raycast"], ["com.runningwithcrayons.Alfred", "Alfred"], ["com.microsoft.VSCode", "Code"], ["com.apple.dt.Xcode", "Xcode"], ["com.apple.Console", "Console"], ["com.github.wez.wezterm", "WezTerm"]] as const) {
    assert.match(appBlock(id, name) ?? "", /never control/, name);
  }
  assert.equal(appBlock("com.apple.TextEdit", "TextEdit"), undefined);
  assert.equal(appBlock("com.apple.Safari", "Safari"), undefined, "ordinary apps stay allowed");
});

test("more secret field names are refused for typing: plural passwords, API and private keys, credit card, SSN, account number", () => {
  for (const label of ["Passwords", "API key", "Api-Key", "Access key", "Private key", "Credit card", "Card no.", "SSN", "Social security number", "Account number", "IBAN", "Routing number"]) {
    assert.ok(secretField({ role: "AXTextField", label }), label);
  }
  assert.equal(secretField({ role: "AXTextField", label: "Search" }), undefined);
});

