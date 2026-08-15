# MCP Editor Neutral Control States Design

## Goal

Remove the pale-blue visual treatment that appears when a user hovers over or focuses a select, input, or textarea in the MCP “Add server” editor.

## Scope

Apply the change only to controls inside `.mcp-field`, which is used by the MCP server editor modal. Hover, focus, focus-visible, and active states keep the existing neutral border and background and do not add an outline or shadow.

## Non-goals

Do not alter form layout, validation behavior, native select menu options, or styling outside the MCP editor.

## Verification

A stylesheet regression test will assert the MCP-specific neutral-state selector and neutral declarations. The focused MCP UI test suite and TypeScript check will run after the CSS update.