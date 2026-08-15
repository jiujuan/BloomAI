# Chat Skill Popover Design

**Date:** 2026-08-15

## Goal

Replace the chat composer’s native Package Skill dropdown with a searchable, paginated popover that selects exactly one enabled skill and renders the choice as a removable chip in the composer.

## User-facing behavior

- The composer toolbar displays a `技能` tab whenever chat-eligible skills are available.
- Clicking it opens a popover. Clicking outside it or pressing Escape closes it.
- The popover contains a search field and cards for only the enabled, chat-eligible skills supplied by `platform.listChatEligibleSkills`.
- Each card shows `packageName` without the server version and the skill `description`.
- Filtering searches the name and description case-insensitively; a new search returns to page 1.
- Pages contain 20 cards. When more than one page exists, show `上一页` / `下一页` and `共 N 页`, with unavailable buttons disabled.
- Clicking a card selects its `skillVersionId`, closes the popover, and shows one light-blue, bold chip in the composer with the skill name and a removal button.
- Removing the chip clears the selected skill. Selecting another skill replaces the current one.
- The existing run submission path continues to use `selectedChatSkillVersionId`.

## Component design

Create `ChatSkillPicker.tsx` to contain popup open state, filtering, paging, document dismissal behavior, and selection UI. `ChatPanelMastra` remains owner of the skill list and selected version ID, so chat-session resets and the existing skill-run request contract stay unchanged.

`ChatSkillPicker` accepts skills, a selected version ID, selection/removal callbacks, and disabled state. It derives the selected skill from the supplied list, preventing separate stale selection metadata. It exports small pure helpers for version stripping and pagination so the behavior can be covered without mounting the full chat panel.

## Styling

Add locally-scoped global CSS classes beside the existing chat composer styles. The popover opens upward from the toolbar, remains within the composer visual language, scrolls its card list independently, and does not affect message area layout. The chip uses the existing info color tokens with bold type and an icon-only accessible delete button.

## Non-goals

- No server/API changes.
- No multi-select skills.
- No persistence of the selected skill across chat-session switches.