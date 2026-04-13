# PaperShare

PaperShare 是一个用于**收集论文、批注论文和团队讨论**的轻量级 Node.js 应用。适合部署在Linux系统的服务器上。

## 快速开始

### 1. 准备运行环境

- 把仓库克隆到本地或服务器后，需要先在机器上安装 `Node.js` 和 `npm`。
- `npm` 通常**不需要单独安装**，安装 `Node.js` 时会一起安装。

可从 Node.js 官网下载安装包：

- 下载页：https://nodejs.org/en/download/
- 版本归档页：https://nodejs.org/en/download/archive/

#### Linux 服务器安装示例

如果你的服务器是常见的 `Linux x64` 架构，可直接安装官方二进制包：

```bash
cd /tmp
curl -LO https://nodejs.org/dist/v24.14.1/node-v24.14.1-linux-x64.tar.xz
sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf node-v24.14.1-linux-x64.tar.xz -C /usr/local/lib/nodejs
echo 'export PATH=/usr/local/lib/nodejs/node-v24.14.1-linux-x64/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
node -v
npm -v
```

- 如果你的服务器是 `ARM64` 架构，请把文件名中的 `linux-x64` 改成 `linux-arm64`。
- 如果机器上没有 `curl`，可先安装后再执行上面的命令。

#### Windows / macOS 安装示例

1. 打开 Node.js 官网下载页：https://nodejs.org/en/download/
2. 下载 `LTS` 版本安装包
3. Windows 运行 `.msi` 安装包，macOS 运行 `.pkg` 安装包
4. 安装完成后，在终端执行：

```bash
node -v
npm -v
```

如果两条命令都能输出版本号，就说明安装成功。

### 2. 安装项目依赖

在项目根目录执行：

```bash
npm install
```

这一步会根据 `package.json` / `package-lock.json` 自动安装当前项目依赖，包括：

- `fast-xml-parser`
- `temml`

### 3. 设置环境参数：

在 `.env` 中填写：

```bash
ELSEVIER_API_KEY=你的Elsevier API key
PAPERSHARE_STORAGE_DIR=你希望的存储地址
PORT=你的端口
```
- `ELSEVIER_API_KEY`建议填写，用于抓取Elsevier文章的正文和Figure。但留空时仍可通过复制文章页面源代码的方式抓取标题、作者、摘要等基础信息。
    - API key申请方式：https://dev.elsevier.com/
，通过组织登录。

- `PORT` 默认值为 `3000`，只有当 3000 端口被占用时才需要修改。

- `PAPERSHARE_STORAGE_DIR` 如果不填，会默认在项目下创建 `.local/storage` 文件夹用于存储应用数据。可自行修改为其它本地文件夹。
    - 不要提交 `.local/`。
    - 不要提交 `.env`。

### 4. 启动服务：

**(1)** 开放端口，终端输入：
```bash
cd 你的文件夹路径/papershare
npm start
```
注：如果远程连接服务器，想在关闭终端后仍保持端口开放，请使用`pm2`，而非`npm start`。

- 安装
    ```bash
    npm install -g pm2
    ```

- 启动
    ```bash
    cd 你的文件夹路径/papershare
    pm2 start server.js --name papershare
    ```

- 查看状态
    ```bash
    pm2 status
    pm2 logs papershare
    ```

- 设置开机自启
    ```bash
    pm2 startup
    pm2 save
    ```

- 以后常用命令：
    - restart = 重启一下
    - stop = 先关掉
    - delete = 从 PM2 名单里移除
    - logs = 看运行记录
    ```bash
    pm2 restart papershare
    pm2 stop papershare
    pm2 delete papershare
    pm2 logs papershare
    ```

**(2)** 访问：

浏览器网址栏输入"部署papershare的Linux服务器的IP地址:端口"
- Linux系统IP地址的查看方法
    ```bash
    ip addr show
    ```
注：此方法需要访问者与部署papershare的Linux服务器在同一内网。

也欢迎尝试探索papershare接入公网的额外操作。

**(3)** 使用内置的管理员账号登录，并尽快在 "个人中心" - "账户设置" 修改密码。用户名也可修改。
- 管理员账号用户名：admin
- 管理员账号初始密码：1234

**(4)** 管理员可以在 "个人中心" - "用户管理" 添加普通用户、转让管理员身份。只有管理员可以注册用户，普通用户无法自行注册。
