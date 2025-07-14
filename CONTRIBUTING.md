# Contributing

## File organization

Each entry for a plant or animal is represented by a single file.

The file structure is as follows:

`data/[kingdom]/[family]/[sub-families, if applicable]/[genus]/[species]/data.yml`

All directory and file names should follow [kebab-case](https://developer.mozilla.org/en-US/docs/Glossary/Kebab_case) conventions,
where all letters are lowercase and dashes `-` are used
in the place of spaces.

For example, the entry for Monarch Butterflies (Danaus plexippus) can be found at:

`data/animalia/nymphalidae/danaus/plexippus/data.yml`

## Using LLMs

LLMs should always be fact-checked, but they can potentially be helpful for quickly gathering information from multiple sources.
[This is the prompt I am currently using as a starting point for creating new entries.](./prompt.md)