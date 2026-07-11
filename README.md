# ritobin-lsp

ritobin-lsp is a language server that provides IDE functionality for editing [ritobin](https://github.com/moonshadow565/ritobin) files, a custom text format to represent League of Legends .bin files. You can use it with any editor that supports the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) (VS Code, Vim, Emacs, Zed, etc.).

> [!WARNING]
> ritobin-lsp is still relatively early in development, so there is always a risk of instability/crashes.

# Installation

On the [releases page](https://github.com/alanpq/ritobin-lsp/releases), the binary is available under `ritobin-lsp`, and the VS Code extension is available under `ritobin-lsp-vs`.

If you're using VS Code, the extension already bundles a copy of the `ritobin-lsp` binary, so you only need the `.vsix`. For other editors, you'll need to download the binary and configure your editor.

> [!NOTE]
> `.vsix` files are also used by Visual Studio, so double clicking will likely not work.
> 
> See VS Code's page for installation instructions [here](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)

# Usage

## VS Code
Just open a `.rito` file or manually set the language to `Ritobin`!

> [!IMPORTANT]
> `.py` files are **not** recognised as ritobin, to not conflict with actual Python files. Rename your files to `.rito`.

For formatting - you can manually run the "Format Document" command, or set up format on save: 
```jsonc
// settings.json
{
    "editor.formatOnSave": true
}
```

## Vim/Emacs/etc.

Configure it as you would for any other language server :)

# Features
- [x] Semantic tokens (syntax highlighting)
- [x] Formatting
- [x] Diagnostics
- [x] File unhash command
- [x] Automatic hashtable updates (with [Mimir](https://github.com/LeagueToolkit/Mimir))
- [ ] Direct opening of `.bin` files ([#32](https://github.com/alanpq/ritobin-lsp/pull/32))
- [ ] [lol-meta-classes](https://github.com/LeagueToolkit/lol-meta-classes) integration
    - [x] Class property auto-complete
    - [ ] Property value auto-complete
    - [x] Class auto-complete
    - [x] Hover information
    - [x] Automatic meta dump updates
- [ ] [LoL Meta Wiki](https://meta-wiki.leaguetoolkit.dev/) integration
    - [x] Links to wiki in hover information
    - [ ] Class/property documentation
- [ ] [modpkg](https://github.com/LeagueToolkit/league-mod/tree/main/crates/ltk_modpkg) support
    - [ ] Linked bin & bin dependency resolution & autocomplete
    - [ ] Asset resolution & autocomplete
- [ ] And much more to come :3
