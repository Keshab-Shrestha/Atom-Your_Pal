// Draws parsed Markdown. Everything is built from elements with text children, never from HTML strings, so a reply cannot inject markup.

import { useMemo } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { parseBlocks, parseInline, type Align, type Block, type Inline } from "./markdown.ts";

function Spans({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            return node.text;
          case "code":
            return <code key={i}>{node.text}</code>;
          case "strong":
            return <strong key={i}><Spans nodes={node.children} /></strong>;
          case "em":
            return <em key={i}><Spans nodes={node.children} /></em>;
          case "del":
            return <del key={i}><Spans nodes={node.children} /></del>;
          case "link":
            return <a key={i} href={node.href} target="_blank" rel="noopener noreferrer"><Spans nodes={node.children} /></a>;
        }
      })}
    </>
  );
}

const Inl = ({ text }: { text: string }) => <Spans nodes={parseInline(text)} />;

/** A line break inside a paragraph or item is a line break on screen, as in the Swift view. */
function Lines({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <>
          {i > 0 ? <br /> : null}
          <Inl text={line} />
        </>
      ))}
    </>
  );
}

const alignStyle = (a: Align | undefined) => (a && a !== "none" ? { textAlign: a } : undefined);

function BlockView({ block }: { block: Block }): ComponentChildren {
  switch (block.kind) {
    case "paragraph":
      return <p><Lines text={block.text} /></p>;
    case "heading":
      return <div class={`md-h md-h${block.level}`} role="heading" aria-level={Math.min(block.level + 2, 6)}><Inl text={block.text} /></div>;
    case "rule":
      return <hr />;
    case "quote":
      return <blockquote><Blocks blocks={block.children} /></blockquote>;
    case "code":
      return (
        <pre tabIndex={0} aria-label={block.language ? `${block.language} code` : "code"}>
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} class={item.checked === undefined ? undefined : "task"}>
          {item.checked === undefined ? null : <span class="check" role="img" aria-label={item.checked ? "done" : "not done"}>{item.checked ? "☑" : "☐"}</span>}
          <Lines text={item.text} />
          {item.children.length > 0 ? <Blocks blocks={item.children} /> : null}
        </li>
      ));
      return block.number === undefined ? <ul>{items}</ul> : <ol start={block.number}>{items}</ol>;
    }
    case "table":
      return (
        <div class="table-scroll" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>{block.header.map((cell, i) => <th key={i} scope="col" style={alignStyle(block.alignment[i])}><Inl text={cell.replace(/\\\|/g, "|")} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, i) => <td key={i} style={alignStyle(block.alignment[i])}><Inl text={cell.replace(/\\\|/g, "|")} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => <BlockView key={i} block={block} />)}</>;
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div class="md"><Blocks blocks={blocks} /></div>;
}
