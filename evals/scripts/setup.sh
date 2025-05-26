#!/bin/bash

menu() {
  echo -e "\n� Which eval types would you like to support?\n"

  for i in ${!options[@]}; do
    printf " %d) %-6s [%s]" $((i + 1)) "${options[i]}" "${choices[i]:- }"

    if [[ $i == 0 ]]; then
      printf " (required)"
    fi

    printf "\n"
  done

  echo -e " q) quit\n"
}

has_asdf_plugin() {
  local plugin="$1"
  case "$plugin" in
    nodejs|python|golang|rust) echo "true" ;;
    *) echo "false" ;;
  esac
}

build_extension() {
  echo "� Building the Kilo Code extension..."
  cd ..
  mkdir -p bin
  npm run install-extension -- --silent --no-audit || exit 1
  npm run install-webview -- --silent --no-audit || exit 1
  npm run install-e2e -- --silent --no-audit || exit 1
  npx vsce package --out bin/kilo-code-latest.vsix || exit 1
  code --install-extension bin/kilo-code-latest.vsix || exit 1
  cd evals
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "⚠️ Only macOS is currently supported."
  exit 1
fi

options=("nodejs" "python" "golang" "rust" "java")
binaries=("node" "python" "go" "rustc" "javac")

for i in "${!options[@]}"; do
  choices[i]="*"
done

prompt="Type 1-5 to select, 'q' to quit, ⏎ to continue: "

while menu && read -rp "$prompt" num && [[ "$num" ]]; do
  [[ "$num" == "q" ]] && exit 0

  [[ "$num" != *[![:digit:]]* ]] &&
    ((num > 1 && num <= ${#options[@]})) ||
    {
      continue
    }

  ((num--))
  [[ "${choices[num]}" ]] && choices[num]="" || choices[num]="*"
done

empty=true

for i in ${!options[@]}; do
  [[ "${choices[i]}" ]] && {
    empty=false
    break
  }
done

[[ "$empty" == true ]] && exit 0

printf "\n"

if ! command -v brew &>/dev/null; then
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    echo "⚠️ Homebrew is installed but not in your PATH"
    exit 1
  fi

  read -p "� Homebrew (https://brew.sh) is required. Install it? (Y/n): " install_brew

  if [[ "$install_brew" =~ ^[Yy]|^$ ]]; then
    echo "� Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || exit 1
    # Can be undone with:
    # /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)" && sudo rm -rvf /opt/homebrew

    if [[ "$SHELL" == "/bin/zsh" ]] && ! grep -q 'eval "$(/opt/homebrew/bin/brew shellenv)"' ~/.zprofile; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && eval "$(/opt/homebrew/bin/brew shellenv)"' >>~/.zprofile
    elif [[ "$SHELL" == "/bin/bash" ]] && ! grep -q 'eval "$(/opt/homebrew/bin/brew shellenv)"' ~/.bash_profile; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && eval "$(/opt/homebrew/bin/brew shellenv)"' >>~/.bash_profile
    fi

    if [[ "$SHELL" == "/bin/zsh" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ "$SHELL" == "/bin/bash" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    BREW_VERSION=$(brew --version)
    echo "✅ Homebrew is installed ($BREW_VERSION)"
  else
    exit 1
  fi
else
  BREW_VERSION=$(brew --version)
  echo "✅ Homebrew is installed ($BREW_VERSION)"
fi

ASDF_PATH="$(brew --prefix asdf)/libexec/asdf.sh"

if ! command -v asdf &>/dev/null; then
  if [[ -f "$ASDF_PATH" ]]; then
    echo "⚠️ asdf is installed but not in your PATH"
    exit 1
  fi

  read -p "�️ asdf (https://asdf-vm.com) is required. Install it? (Y/n): " install_asdf

  if [[ "$install_asdf" =~ ^[Yy]|^$ ]]; then
    echo "�️ Installing asdf..."
    brew install asdf || exit 1
    # Can be undone with:
    # brew uninstall asdf
    # rm -rvf ~/.asdf

    . "$ASDF_PATH"

    if [[ "$SHELL" == "/bin/zsh" ]] && ! grep -q 'source "$(brew --prefix asdf)/libexec/asdf.sh"' ~/.zshrc; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && [[ -s "$(brew --prefix asdf)/libexec/asdf.sh" ]] && source "$(brew --prefix asdf)/libexec/asdf.sh"' >>~/.zprofile
    elif [[ "$SHELL" == "/bin/bash" ]] && ! grep -q 'source "$(brew --prefix asdf)/libexec/asdf.sh"' ~/.bash_profile; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && [[ -s "$(brew --prefix asdf)/libexec/asdf.sh" ]] && source "$(brew --prefix asdf)/libexec/asdf.sh"' >>~/.bash_profile
    fi

    ASDF_VERSION=$(asdf --version)
    echo "✅ asdf is installed ($ASDF_VERSION)"
  else
    exit 1
  fi
else
  ASDF_VERSION=$(asdf --version)
  echo "✅ asdf is installed ($ASDF_VERSION)"
  . "$ASDF_PATH"
fi

if ! command -v gh &>/dev/null; then
  read -p "�‍� GitHub cli is needed to submit evals results. Install it? (Y/n): " install_gh

  if [[ "$install_gh" =~ ^[Yy]|^$ ]]; then
    brew install gh || exit 1
    GH_VERSION=$(gh --version | head -n 1)
    echo "✅ gh is installed ($GH_VERSION)"
    gh auth status || gh auth login -w -p https
  fi
else
  GH_VERSION=$(gh --version | head -n 1)
  echo "✅ gh is installed ($GH_VERSION)"
fi

for i in "${!options[@]}"; do
  [[ "${choices[i]}" ]] || continue

  plugin="${options[$i]}"
  binary="${binaries[$i]}"

  if [[ "$(has_asdf_plugin "$plugin")" == "true" ]]; then
    if ! asdf plugin list | grep -q "^${plugin}$" && ! command -v "${binary}" &>/dev/null; then
      echo "� Installing ${plugin} asdf plugin..."
      asdf plugin add "${plugin}" || exit 1
      echo "✅ asdf ${plugin} plugin installed successfully"
    fi
  fi

  case "${plugin}" in
  "nodejs")
    if ! command -v node &>/dev/null; then
      asdf install nodejs 20.18.1 || exit 1
      asdf set nodejs 20.18.1 || exit 1
      NODE_VERSION=$(node --version)
      echo "✅ Node.js is installed ($NODE_VERSION)"
    else
      NODE_VERSION=$(node --version)
      echo "✅ Node.js is installed ($NODE_VERSION)"
    fi

    if [[ $(node --version) != "v20.18.1" ]]; then
      NODE_VERSION=$(node --version)
      echo "� You have the wrong version of node installed ($NODE_VERSION)."
      echo "� If you are using nvm then run 'nvm install' to install the version specified by the repo's .nvmrc."
      exit 1
    fi
    ;;

  "python")
    if ! command -v python &>/dev/null; then
      asdf install python 3.13.2 || exit 1
      asdf set python 3.13.2 || exit 1
      PYTHON_VERSION=$(python --version)
      echo "✅ Python is installed ($PYTHON_VERSION)"
    else
      PYTHON_VERSION=$(python --version)
      echo "✅ Python is installed ($PYTHON_VERSION)"
    fi

    if ! command -v uv &>/dev/null; then
      brew install uv || exit 1
      UV_VERSION=$(uv --version)
      echo "✅ uv is installed ($UV_VERSION)"
    else
      UV_VERSION=$(uv --version)
      echo "✅ uv is installed ($UV_VERSION)"
    fi
    ;;

  "golang")
    if ! command -v go &>/dev/null; then
      asdf install golang 1.24.2 || exit 1
      asdf set golang 1.24.2 || exit 1
      GO_VERSION=$(go version)
      echo "✅ Go is installed ($GO_VERSION)"
    else
      GO_VERSION=$(go version)
      echo "✅ Go is installed ($GO_VERSION)"
    fi
    ;;

  "rust")
    if ! command -v rustc &>/dev/null; then
      asdf install rust 1.85.1 || exit 1
      asdf set rust 1.85.1 || exit 1
      RUST_VERSION=$(rustc --version)
      echo "✅ Rust is installed ($RUST_VERSION)"
    else
      RUST_VERSION=$(rustc --version)
      echo "✅ Rust is installed ($RUST_VERSION)"
    fi
    ;;

  "java")
    if ! command -v javac &>/dev/null || ! javac --version &>/dev/null; then
      echo "☕ Installing Java..."
      brew install openjdk@17 || exit 1

      export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"

      if [[ "$SHELL" == "/bin/zsh" ]] && ! grep -q 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' ~/.zprofile; then
        echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zprofile
      elif [[ "$SHELL" == "/bin/bash" ]] && ! grep -q 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' ~/.bash_profile; then
        echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.bash_profile
      fi

      JAVA_VERSION=$(javac --version | head -n 1)
      echo "✅ Java is installed ($JAVA_VERSION)"
    else
      JAVA_VERSION=$(javac --version | head -n 1)
      echo "✅ Java is installed ($JAVA_VERSION)"
    fi
    ;;
  esac
done

if ! command -v pnpm &>/dev/null; then
  brew install pnpm || exit 1
  PNPM_VERSION=$(pnpm --version)
  echo "✅ pnpm is installed ($PNPM_VERSION)"
else
  PNPM_VERSION=$(pnpm --version)
  echo "✅ pnpm is installed ($PNPM_VERSION)"
fi

pnpm install --silent || exit 1

if ! command -v code &>/dev/null; then
  echo "⚠️ Visual Studio Code cli is not installed"
  exit 1
else
  VSCODE_VERSION=$(code --version | head -n 1)
  echo "✅ Visual Studio Code is installed ($VSCODE_VERSION)"
fi

# To reset VSCode:
# rm -rvf ~/.vscode && rm -rvf ~/Library/Application\ Support/Code

echo -n "� Installing Visual Studio Code extensions... "
code --install-extension golang.go &>/dev/null || exit 1
code --install-extension dbaeumer.vscode-eslint&>/dev/null || exit 1
code --install-extension redhat.java &>/dev/null || exit 1
code --install-extension ms-python.python&>/dev/null || exit 1
code --install-extension rust-lang.rust-analyzer &>/dev/null || exit 1

if ! code --list-extensions 2>/dev/null | grep -q "kilocode.Kilo-Code"; then
  code --install-extension kilocode.Kilo-Code &>/dev/null || exit 1
fi

echo "✅ Done"

if [[ ! -d "../../evals" ]]; then
  echo -n "� Cloning evals repository... "

  if gh auth status &>/dev/null; then
    gh repo clone cte/evals ../../evals || exit 1
  else
    git clone https://github.com/cte/evals.git ../../evals || exit 1
  fi

  echo "✅ Done"
else
  echo -n "� Updating evals repository... "

  (cd ../../evals && \
    git checkout -f &>/dev/null && \
    git clean -f -d &>/dev/null && \
    git checkout main &>/dev/null && \
    git pull &>/dev/null) || { echo "❌ Failed to update evals repository."; exit 1; }

  echo "✅ Done"
fi

if [[ ! -s .env ]]; then
  cp .env.sample .env || exit 1
fi

echo -n "�️ Syncing Kilo Code evals database... "
pnpm --filter @evals/db db:push &>/dev/null || exit 1
pnpm --filter @evals/db db:enable-wal &>/dev/null || exit 1
echo "✅ Done"

if ! grep -q "OPENROUTER_API_KEY" .env; then
  read -p "� Enter your OpenRouter API key (sk-or-v1-...): " openrouter_api_key
  echo "� Validating..."
  curl --silent --fail https://openrouter.ai/api/v1/key -H "Authorization: Bearer $openrouter_api_key" &>/dev/null || exit 1
  echo "OPENROUTER_API_KEY=$openrouter_api_key" >> .env || exit 1
fi

current_version=$(code --list-extensions --show-versions 2>/dev/null | grep kilocode)
read -p "� Do you want to build a new version of the Kilo Code extension? [currently $current_version] (y/N): " build_extension

if [[ "$build_extension" =~ ^[Yy]$ ]]; then
  build_extension
fi

echo -e "\n� You're ready to rock and roll! \n"

if ! nc -z localhost 3000; then
  read -p "� Would you like to start the evals web app? (Y/n): " start_evals

  if [[ "$start_evals" =~ ^[Yy]|^$ ]]; then
    pnpm web
  else
    echo "� You can start it anytime with 'pnpm web'."
  fi
else
  echo "� The evals web app is running at http://localhost:3000"
fi
