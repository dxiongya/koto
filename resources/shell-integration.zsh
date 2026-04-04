#!/bin/zsh
# Lite Terminal — Shell Integration
# Auto-sources common zsh plugins if installed. No user config needed.

# ── History settings ──
HISTSIZE=50000
SAVEHIST=50000
setopt SHARE_HISTORY          # share across sessions
setopt HIST_IGNORE_ALL_DUPS   # no duplicates
setopt HIST_REDUCE_BLANKS     # trim whitespace
setopt INC_APPEND_HISTORY     # write immediately

# ── Completion ──
autoload -Uz compinit
compinit -C  # -C skips security check for speed
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'  # case-insensitive

# ── Key bindings ──
bindkey '^[[A' up-line-or-search      # Up arrow: history search
bindkey '^[[B' down-line-or-search    # Down arrow: history search
bindkey '^R' history-incremental-search-backward

# ── Auto-source plugins from common locations ──
_lite_try_source() {
  [ -f "$1" ] && source "$1"
}

# zsh-autosuggestions (gray inline suggestions from history)
if ! typeset -f _zsh_autosuggest_start > /dev/null 2>&1; then
  _lite_try_source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh ||
  _lite_try_source /usr/local/share/zsh-autosuggestions/zsh-autosuggestions.zsh ||
  _lite_try_source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ||
  _lite_try_source "${HOME}/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh" ||
  _lite_try_source "${ZSH_CUSTOM:-${ZSH:-$HOME/.oh-my-zsh}/custom}/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"
  # Style: subtle gray
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#555555"
fi

# zsh-syntax-highlighting (colorize command input)
if ! typeset -f _zsh_highlight > /dev/null 2>&1; then
  _lite_try_source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ||
  _lite_try_source /usr/local/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ||
  _lite_try_source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ||
  _lite_try_source "${HOME}/.zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ||
  _lite_try_source "${ZSH_CUSTOM:-${ZSH:-$HOME/.oh-my-zsh}/custom}/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
fi

# zoxide (smart cd / z command)
if command -v zoxide > /dev/null 2>&1; then
  eval "$(zoxide init zsh)"
fi

# fzf integration (fuzzy history search with Ctrl+R)
if command -v fzf > /dev/null 2>&1; then
  _lite_try_source /opt/homebrew/opt/fzf/shell/key-bindings.zsh ||
  _lite_try_source /usr/share/fzf/key-bindings.zsh ||
  _lite_try_source "${HOME}/.fzf.zsh"
fi

unfunction _lite_try_source
