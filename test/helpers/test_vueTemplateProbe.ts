// Self-checks for the SFC probe that the #2493 wiring tests rely on.
//
// The probe only earns its keep if it DISCRIMINATES: a click handler
// sitting on the parent, on a sibling, or on a second `v-html` element
// must not read as "the markdown body is wired". These fixtures pin
// exactly the cases a naive source grep would wave through.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findVHtmlBindings } from "./vueTemplateProbe.ts";

const sfc = (template: string): string => `<template>\n${template}\n</template>\n`;

describe("findVHtmlBindings — element association", () => {
  it("reports the handler bound on the v-html element itself", () => {
    const bindings = findVHtmlBindings(sfc(`<div class="body" @click="handleExternalLinkClick" v-html="renderedBody"></div>`));
    assert.deepEqual(bindings, [{ tag: "div", htmlExpression: "renderedBody", clickHandlers: ["handleExternalLinkClick"] }]);
  });

  it("does NOT credit a handler bound on the PARENT of the v-html element", () => {
    // The exact shape a "keep both sides" conflict resolution produces:
    // the handler name is still in the file, one element too high.
    const bindings = findVHtmlBindings(sfc(`<div @click="handleExternalLinkClick"><div v-html="renderedBody"></div></div>`));
    assert.deepEqual(bindings, [{ tag: "div", htmlExpression: "renderedBody", clickHandlers: [] }]);
  });

  it("does NOT credit a handler bound on a SIBLING of the v-html element", () => {
    const bindings = findVHtmlBindings(sfc(`<button @click="handleExternalLinkClick">x</button><div v-html="renderedBody"></div>`));
    assert.deepEqual(bindings, [{ tag: "div", htmlExpression: "renderedBody", clickHandlers: [] }]);
  });

  it("does NOT credit a handler bound on a CHILD of the v-html element", () => {
    const bindings = findVHtmlBindings(sfc(`<div v-html="renderedBody"><span @click="handleExternalLinkClick"></span></div>`));
    assert.deepEqual(bindings, [{ tag: "div", htmlExpression: "renderedBody", clickHandlers: [] }]);
  });

  it("reports each v-html element separately, so one wired body can't cover an unwired one", () => {
    const bindings = findVHtmlBindings(sfc(`<div v-html="a" @click="handleExternalLinkClick"></div><section><article v-html="b"></article></section>`));
    assert.deepEqual(bindings, [
      { tag: "div", htmlExpression: "a", clickHandlers: ["handleExternalLinkClick"] },
      { tag: "article", htmlExpression: "b", clickHandlers: [] },
    ]);
  });

  it("finds a v-html element nested deep in the template", () => {
    const bindings = findVHtmlBindings(sfc(`<div><section><template v-if="ok"><p v-html="body" @click="onClick"></p></template></section></div>`));
    assert.deepEqual(bindings, [{ tag: "p", htmlExpression: "body", clickHandlers: ["onClick"] }]);
  });
});

describe("findVHtmlBindings — binding syntax variants", () => {
  it("recognises the long-form v-on:click", () => {
    const bindings = findVHtmlBindings(sfc(`<div v-on:click="handleExternalLinkClick" v-html="body"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, ["handleExternalLinkClick"]);
  });

  it("recognises a click handler carrying modifiers (@click.capture)", () => {
    const bindings = findVHtmlBindings(sfc(`<div @click.capture="handleExternalLinkClick" v-html="body"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, ["handleExternalLinkClick"]);
  });

  it("keeps the raw expression for an inline arrow handler", () => {
    const bindings = findVHtmlBindings(sfc(`<div @click="(e) => handleExternalLinkClick(e)" v-html="body"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, ["(e) => handleExternalLinkClick(e)"]);
  });

  it("ignores non-click listeners on the v-html element", () => {
    const bindings = findVHtmlBindings(sfc(`<div @mousedown="handleExternalLinkClick" @keyup="onKey" v-html="body"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, []);
  });

  it("does not treat a dynamic event argument as a click binding", () => {
    const bindings = findVHtmlBindings(sfc(`<div @[eventName]="handleExternalLinkClick" v-html="body"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, []);
  });
});

describe("findVHtmlBindings — empty / edge inputs", () => {
  it("returns an empty list when the template has no v-html at all", () => {
    assert.deepEqual(findVHtmlBindings(sfc(`<div @click="handleExternalLinkClick">plain</div>`)), []);
  });

  it("returns an empty list for an empty template", () => {
    assert.deepEqual(findVHtmlBindings(sfc("")), []);
  });

  it("tolerates comments, text nodes and interpolation around the v-html element", () => {
    const bindings = findVHtmlBindings(sfc(`<!-- note --> text {{ value }} <div v-html="body" @click="handleExternalLinkClick"></div>`));
    assert.deepEqual(bindings[0].clickHandlers, ["handleExternalLinkClick"]);
  });

  it("reports a v-html element with no expression rather than skipping it", () => {
    const bindings = findVHtmlBindings(sfc(`<div v-html @click="handleExternalLinkClick"></div>`));
    assert.deepEqual(bindings, [{ tag: "div", htmlExpression: null, clickHandlers: ["handleExternalLinkClick"] }]);
  });

  it("throws when the file has no <template> block", () => {
    assert.throws(() => findVHtmlBindings(`<script setup lang="ts">const a = 1;</script>\n`), /no <template> block/);
  });
});
