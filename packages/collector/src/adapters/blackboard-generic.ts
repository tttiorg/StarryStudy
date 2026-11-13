// 通用 Blackboard + CAS 采集流程。所有地址、路径模板都来自 config.bb，
// 代码里不出现任何站点域名：换学校只改 .env，不改这份代码。
import type { BbConfig } from "@starry/shared";
import {
  HttpClient,
  USER_AGENT,
  sameHost,
  dumpDebugHtml,
  type HttpResponse,
} from "../http";
import {
  pickInput,
  parseCourseList,
  parseCoursePage,
  normalizeCalendarEvents,
  type BbCourse,
  type BbGradeRow,
  type BbCalendarEvent,
} from "../parse";

export interface BbCourseGrades {
  courseId: string;
  courseName: string;
  rows: BbGradeRow[]; // 全部行（含无分数），由 plan 再筛
  error: string;
}

/** 注册表里每个适配器都按这个契约分步跑，调度不关心内部怎么登、怎么抓。 */
export interface CollectorAdapter {
  readonly id: string;
  readonly label: string;
  login(): Promise<void>;
  listCourses(): Promise<BbCourse[]>;
  fetchGrades(courses: BbCourse[]): Promise<BbCourseGrades[]>;
  fetchCalendar(courses: BbCourse[]): Promise<BbCalendarEvent[]>;
}

const DAY_MS = 86_400_000;

export class BlackboardGenericAdapter implements CollectorAdapter {
  readonly id = "blackboard-generic";
  readonly label = "Blackboard（通用 CAS + 成绩 + 日历）";
  private readonly http: HttpClient;

  constructor(private readonly cfg: BbConfig) {
    this.http = new HttpClient({ userAgent: USER_AGENT });
  }

  private join(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private get casLoginUrl(): string {
    return `${this.cfg.casUrl.replace(/\/+$/, "")}/cas/login`;
  }

  private get serviceUrl(): string {
    return this.join(this.cfg.servicePath);
  }

  private isCas(url: string): boolean {
    return url ? sameHost(url, this.cfg.casUrl) : false;
  }

  private isBb(url: string): boolean {
    return url ? sameHost(url, this.cfg.baseUrl) : false;
  }

  private async freshSession(): Promise<void> {
    // 旧 cookie 会干扰重登，先清空再走一遍完整登录
    this.http.clearJar();
    await this.login();
  }

  /** CAS 登录：先抠 execution 令牌，再 POST 表单，最后确认落到 BB 域。 */
  async login(): Promise<void> {
    const pageUrl = `${this.casLoginUrl}?service=${encodeURIComponent(this.serviceUrl)}&locale=zh_CN`;
    const page = await this.http.request(pageUrl);
    const execution = pickInput(page.body, "execution");
    if (!execution) {
      const hint = await dumpDebugHtml("cas-login", page.body);
      throw new Error(
        `登录页里没找到 execution 令牌（CAS 可能改版了）${hint ? `；响应已存 ${hint}` : ""}`
      );
    }

    const form = new URLSearchParams({
      username: this.cfg.user,
      password: this.cfg.password,
      execution,
      _eventId: "submit",
      geolocation: "",
    });
    const posted = await this.http.request(this.casLoginUrl, { method: "POST", body: form });

    // 成功判定用配置的 baseUrl 比对，不写死学校域名
    const landed = posted.url;
    if (!/ticket=ST-/.test(landed) && !this.isBb(landed)) {
      const hint = await dumpDebugHtml("cas-fail", posted.body);
      const why = /密码|password|错误|error|invalid/i.test(posted.body)
        ? "学号或密码不对"
        : `CAS 没有回跳（停在 ${landed}）`;
      throw new Error(`登录失败：${why}${hint ? `；响应已存 ${hint}，请自行查看` : ""}`);
    }

    // 有时还要再跳一次 service 才把 BB 会话 cookie 种下来
    if (!this.http.hasSessionCookie()) {
      await this.http.request(this.serviceUrl);
    }
    if (this.http.jar.size === 0) {
      const hint = await dumpDebugHtml("cas-no-cookie", posted.body);
      throw new Error(`登录走完了但没拿到任何 cookie${hint ? `；响应已存 ${hint}` : ""}`);
    }
  }

  /** GET 类请求被踢回 CAS 域 = 会话过期，重登一次再重试，最多一次（BB-04）。 */
  private async bbGet(url: string): Promise<HttpResponse> {
    let r = await this.http.request(url);
    if (this.isCas(r.url)) {
      await this.freshSession();
      r = await this.http.request(url);
      if (this.isCas(r.url)) throw new Error("会话失效：重登后仍被重定向到 CAS");
    }
    return r;
  }

  /** streamViewer 的 loadStream 是 POST 表单；3xx/401/403 都算会话过期（BB-04）。 */
  private async bbPostStream(): Promise<unknown> {
    const url = this.join(this.cfg.streamPath);
    const form = new URLSearchParams({
      cmd: "loadStream",
      streamName: "mygrades",
      providers: "[]",
      forOverview: "false",
    });
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${url}?cmd=view&streamName=mygrades`,
    };
    const send = () =>
      this.http.request(url, {
        method: "POST",
        body: form,
        headers,
        followRedirects: false, // 3xx 本身就是要识别的过期信号，不能自动跟
        timeoutMs: 25_000,
      });
    const expired = (r: HttpResponse): boolean =>
      (r.status >= 300 && r.status < 400) ||
      r.status === 401 ||
      r.status === 403 ||
      this.isCas(r.location);

    let r = await send();
    if (expired(r)) {
      await this.freshSession();
      r = await send();
      if (expired(r)) throw new Error("会话失效：重登后 streamViewer 仍被拒绝");
    }
    if (r.status !== 200) {
      const hint = await dumpDebugHtml("stream", r.body);
      throw new Error(`streamViewer 返回 ${r.status}${hint ? `；响应已存 ${hint}` : ""}`);
    }
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      const hint = await dumpDebugHtml("stream-not-json", r.body);
      throw new Error(
        `streamViewer 没返回 JSON（会话可能失效或接口改版）${hint ? `；响应已存 ${hint}` : ""}`
      );
    }
  }

  async listCourses(): Promise<BbCourse[]> {
    return parseCourseList(await this.bbPostStream());
  }

  /** 成绩第二步：逐门课取服务端渲染的明细页。一门课出错不影响其他课。 */
  async fetchGrades(courses: BbCourse[]): Promise<BbCourseGrades[]> {
    const out: BbCourseGrades[] = [];
    for (const c of courses) {
      const url = `${this.join(this.cfg.myGradesPath)}?course_id=${encodeURIComponent(c.id)}&stream_name=mygrades`;
      let rows: BbGradeRow[] = [];
      let error = "";
      try {
        const page = await this.bbGet(url);
        rows = parseCoursePage(page.body);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      out.push({ courseId: c.id, courseName: c.name, rows, error });
    }
    return out;
  }

  /** 日历：往前 120 天、往后 180 天，够覆盖一个学期。 */
  async fetchCalendar(courses: BbCourse[]): Promise<BbCalendarEvent[]> {
    const now = Date.now();
    const url =
      `${this.join(this.cfg.calendarPath)}?start=${now - 120 * DAY_MS}` +
      `&end=${now + 180 * DAY_MS}&course_id=&mode=personal`;
    let r: HttpResponse;
    try {
      r = await this.bbGet(url);
    } catch (e) {
      throw new Error(`日历拉取失败：${e instanceof Error ? e.message : String(e)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(r.body) as unknown;
    } catch {
      const hint = await dumpDebugHtml("calendar-not-json", r.body);
      throw new Error(`日历接口没返回 JSON（会话可能失效了）${hint ? `；响应已存 ${hint}` : ""}`);
    }
    return normalizeCalendarEvents(data, courses);
  }
}
