// Test helper — reports which template element in a Vue SFC carries a
// `v-html` binding, and which click handlers are bound ON THAT SAME
// element.
//
// Wiring regressions of the "the directive drifted onto another
// element" kind (#2493: a conflict resolution nearly dropped
// `@click="handleExternalLinkClick"` off the markdown body) are
// invisible to a source-text grep — the handler name is still in the
// file, just on the wrong node. Parsing with the same compiler Vue
// itself uses makes the element association the thing under test.

import { parse } from "vue/compiler-sfc";

// `NodeTypes` is not part of the `vue/compiler-sfc` type surface, so
// the AST discriminants are named here rather than left as bare
// numbers at the comparison sites.
const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_SIMPLE_EXPRESSION = 4;
const NODE_TYPE_DIRECTIVE = 7;

type SfcTemplateAst = NonNullable<NonNullable<ReturnType<typeof parse>["descriptor"]["template"]>["ast"]>;
type TemplateChild = SfcTemplateAst["children"][number];
type ElementNode = Extract<TemplateChild, { type: typeof NODE_TYPE_ELEMENT }>;
type ElementProp = ElementNode["props"][number];
type DirectiveNode = Extract<ElementProp, { type: typeof NODE_TYPE_DIRECTIVE }>;
type ExpressionNode = NonNullable<DirectiveNode["exp"]>;

export interface VHtmlBinding {
  tag: string;
  // Expression passed to `v-html` (`renderedBody`, …).
  htmlExpression: string | null;
  // Expressions of every `v-on:click` / `@click` on the same element,
  // modifiers included (`@click.capture` counts).
  clickHandlers: string[];
}

const isDirective = (prop: ElementProp): prop is DirectiveNode => prop.type === NODE_TYPE_DIRECTIVE;

// Dynamic arguments / compound expressions (`@[evt]`, `@click="a(); b()"`)
// are not static text, so they read as "no static content" rather than
// being flattened into something a caller could mistake for a name.
const staticContent = (node: ExpressionNode | undefined): string | null =>
  node !== undefined && node.type === NODE_TYPE_SIMPLE_EXPRESSION ? node.content : null;

const clickHandlersOf = (element: ElementNode): string[] =>
  element.props
    .filter(isDirective)
    .filter((directive) => directive.name === "on" && staticContent(directive.arg) === "click")
    .map((directive) => staticContent(directive.exp))
    .filter((expression): expression is string => expression !== null);

const vHtmlExpressionOf = (element: ElementNode): string | null | undefined => {
  const directive = element.props.filter(isDirective).find((prop) => prop.name === "html");
  return directive === undefined ? undefined : staticContent(directive.exp);
};

const collectBindings = (node: TemplateChild, found: VHtmlBinding[]): void => {
  if (node.type !== NODE_TYPE_ELEMENT) return;
  const htmlExpression = vHtmlExpressionOf(node);
  if (htmlExpression !== undefined) {
    found.push({ tag: node.tag, htmlExpression, clickHandlers: clickHandlersOf(node) });
  }
  node.children.forEach((child) => collectBindings(child, found));
};

// Every `v-html` element in `sfcSource`, in template order.
export function findVHtmlBindings(sfcSource: string): VHtmlBinding[] {
  const { descriptor, errors } = parse(sfcSource);
  if (errors.length > 0) {
    throw new Error(`SFC parse failed: ${errors.map((error) => error.message).join("; ")}`);
  }
  const ast = descriptor.template?.ast;
  if (ast === undefined) {
    throw new Error("SFC has no <template> block");
  }
  const found: VHtmlBinding[] = [];
  ast.children.forEach((child) => collectBindings(child, found));
  return found;
}
