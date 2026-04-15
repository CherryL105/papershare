# PaperShare Docker 安装说明

## 1. 拉取镜像

推荐使用固定版本：

```bash
docker pull cherryl105/papershare:1.0.0
```

也可以使用最新版标签：

```bash
docker pull cherryl105/papershare:latest
```

## 2. 启动容器

```bash
docker run -d \
  --name papershare \
  -p 3000:3000 \
  -e PORT=3000 \
  -e ELSEVIER_API_KEY=你的Elsevier_API_key \
  -v papershare_data:/data \
  cherryl105/papershare:1.0.0
```

说明：
- `-p 3000:3000`：把宿主机 3000 端口映射到容器 3000 端口
- `-e PORT=3000`：容器内服务端口
- `-e ELSEVIER_API_KEY=...`：可选；如果需要抓取 Elsevier 正文和 Figure，建议填写
- `-v papershare_data:/data`：把应用数据持久化到 Docker volume，重启或升级容器后数据不会丢失

## 3. 访问系统

浏览器打开：

```text
http://服务器IP:3000
```

如果是在本机运行，也可以直接访问：

```text
http://127.0.0.1:3000
```

## 4. 初始管理员账号

首次启动后，使用内置管理员账号登录：

- 用户名：`admin`
- 密码：`1234`

登录后建议尽快在“个人中心”中修改密码。

## 5. 常用命令

查看运行状态：

```bash
docker ps
```

查看日志：

```bash
docker logs -f papershare
```

停止容器：

```bash
docker stop papershare
```

再次启动：

```bash
docker start papershare
```

删除容器：

```bash
docker rm -f papershare
```

## 6. 升级到新版本

先拉取新镜像：

```bash
docker pull cherryl105/papershare:1.0.0
```

然后删除旧容器并重新启动：

```bash
docker rm -f papershare
docker run -d \
  --name papershare \
  -p 3000:3000 \
  -e PORT=3000 \
  -e ELSEVIER_API_KEY=你的Elsevier_API_key \
  -v papershare_data:/data \
  cherryl105/papershare:1.0.0
```

由于数据保存在 `papershare_data` volume 中，所以升级后原有数据会保留。
