# 克隆项目
git clone <your-repo>
cd git-ai-review

# 安装依赖
npm install

# 编译
npm run compile

# 打包为 .vsix
npm run package
# → 生成 git-ai-review-1.0.0.vsix

# 在 VSCode/Cursor 中安装
# 方式1: Extensions → ⋯ → Install from VSIX → 选择 .vsix 文件
# 方式2: code --install-extension git-ai-review-1.0.0.vsix
# 方式3: cursor --install-extension git-ai-review-1.0.0.vsix
