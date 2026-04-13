# PaperShare

PaperShare 是一个用于**收集论文、批注论文和团队讨论**的轻量级 Node.js 应用。适合部署在Linux系统的服务器上。

## 快速开始

### 1. 安装依赖：

```bash
npm install
```

### 2. 设置环境参数：

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

- `PAPERSHARE_STORAGE_DIR` 默认值为项目下的 `.local/storage` 文件夹。该文件夹里有样例文章、样例批注和样例讨论。可自修改为其它本地文件夹。
    - 不要提交 `.local/`。
    - 不要提交 `.env`。

### 3. 启动服务：

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
