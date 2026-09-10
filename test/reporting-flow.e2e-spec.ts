import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(180_000);

describe('Authentication and reporting flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let labId = '';
  let patientId = '';
  let orderId = '';
  let testIds: string[] = [];
  let email = '';
  let password = '';
  let accessToken = '';
  let technicianToken = '';
  let receptionistToken = '';
  let refreshAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const unique = randomUUID();
    email = `e2e-${unique}@example.invalid`;
    password = `Test-${unique}-Pass!`;
    const mobile = `9${String(Date.now()).slice(-9)}`;
    refreshAgent = request.agent(app.getHttpServer());

    const signupRequest = await request(app.getHttpServer()).post('/auth/signup/request-otp').send({ name: 'E2E Diagnostic Laboratory', mobile, email: `lab-${unique}@example.invalid`, admin: { email, mobile, password } }).expect(201);
    expect(signupRequest.body.requestId).toBeTruthy();
    expect(signupRequest.body.expiresAt).toBeTruthy();
    expect(signupRequest.body.delivery).toBe('development');
    expect(signupRequest.body.devOtp).toMatch(/^\d{6}$/);
    const signupComplete = await request(app.getHttpServer()).post('/auth/signup/verify-otp').send({ requestId: signupRequest.body.requestId, otp: signupRequest.body.devOtp }).expect(201);
    expect(signupComplete.body.success).toBe(true);
    expect(signupComplete.body.lab.id).toBeTruthy();
    expect(signupComplete.body.user.email).toBe(email);
    expect(signupComplete.body.user.password).toBeUndefined();
    expect(signupComplete.body.message).toContain('Signup completed');
    labId = signupComplete.body.lab.id;

    const login = await refreshAgent.post('/auth/login').send({ email, password }).expect(201);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.body.user.email).toBe(email);
    expect(login.body.user.password).toBeUndefined();
    accessToken = login.body.accessToken;
    const me = await refreshAgent.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(me.body.user.id).toBe(login.body.user.id);
    expect(me.body.lab.id).toBe(labId);
    const refreshed = await refreshAgent.post('/auth/refresh').expect(201);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeUndefined();
    accessToken = refreshed.body.accessToken;

    const rolePassword = `Role-${unique}-Pass!`;
    const passwordHash = await bcrypt.hash(rolePassword, 12);
    await prisma.user.createMany({
      data: [
        { labId, username: `tech-${unique}`, mobile: `8${String(Date.now()).slice(-9)}`, email: `tech-${unique}@example.invalid`, password: passwordHash, role: 'TECHNICIAN' },
        { labId, username: `reception-${unique}`, mobile: `7${String(Date.now() + 1).slice(-9)}`, email: `reception-${unique}@example.invalid`, password: passwordHash, role: 'RECEPTIONIST' },
      ],
    });

    const technicianLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: `tech-${unique}@example.invalid`, password: rolePassword }).expect(201);
    technicianToken = technicianLogin.body.accessToken;
    const receptionistLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: `reception-${unique}@example.invalid`, password: rolePassword }).expect(201);
    receptionistToken = receptionistLogin.body.accessToken;

    const parameterData = [
      { name: 'Result', inputType: 'NUMBER' as const, unit: 'mg/dL', normalMin: 1, normalMax: 100, displayOrder: 0, isRequired: true },
      { name: 'Comment', inputType: 'TEXT' as const, unit: null, normalMin: null, normalMax: null, displayOrder: 1, isRequired: true },
    ];
    const firstTest = await prisma.test.create({ data: { labId, code: `E2E-A-${unique.slice(0, 8)}`, name: 'E2E Chemistry Test', category: 'E2E', department: 'CHEMISTRY', sampleType: 'SERUM', isActive: true, parameters: { create: parameterData } } });
    const secondTest = await prisma.test.create({ data: { labId, code: `E2E-B-${unique.slice(0, 8)}`, name: 'E2E Hematology Test', category: 'E2E', department: 'HEMATOLOGY', sampleType: 'BLOOD', isActive: true, parameters: { create: parameterData } } });
    testIds = [firstTest.id, secondTest.id];
  });

  afterAll(async () => {
    if (labId) {
      await prisma.user.deleteMany({ where: { labId } }).catch(() => undefined);
      await prisma.lab.delete({ where: { id: labId } }).catch(() => undefined);
    }
    await app?.close();
  });

  it('rejects invalid sign-in credentials', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'definitely-wrong-password' }).expect(401);
  });

  it('runs patient registration through multi-test final report, blocks receptionist result actions, lets technician verify/finalize, and validates PDF', async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const technicianAuth = { Authorization: `Bearer ${technicianToken}` };
    const receptionistAuth = { Authorization: `Bearer ${receptionistToken}` };
    const patient = await request(app.getHttpServer()).post('/patients').set(auth).send({ name: 'E2E Patient', age: 35, gender: 'MALE', mobile: '9000000001', email: 'patient@example.invalid' }).expect(201);
    patientId = patient.body.id;
    const order = await request(app.getHttpServer()).post('/orders').set(auth).send({ patientId, testIds, referredBy: 'E2E Doctor', clinicalNotes: 'E2E reporting flow' }).expect(201);
    orderId = order.body.id;
    expect(order.body.items).toHaveLength(2);

    await request(app.getHttpServer()).post(`/orders/${orderId}/finalize`).set(receptionistAuth).expect(403);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/results`).set(receptionistAuth).send({ results: [] }).expect(403);
    await request(app.getHttpServer()).post(`/orders/${orderId}/verify`).set(receptionistAuth).expect(403);

    const samples = await request(app.getHttpServer()).post(`/samples/orders/${orderId}`).set(auth).send({}).expect(201);
    expect(Array.isArray(samples.body)).toBe(true);
    expect(samples.body.length).toBeGreaterThanOrEqual(1);
    for (const sample of samples.body) for (const status of ['COLLECTED', 'RECEIVED', 'PROCESSING', 'COMPLETED']) await request(app.getHttpServer()).patch(`/samples/${sample.id}/status`).set(auth).send({ status }).expect(200);
    const testDetails = await Promise.all(testIds.map((id) => request(app.getHttpServer()).get(`/tests/${id}`).set(auth).expect(200)));
    const results = testDetails.flatMap((response) => response.body.parameters.map((parameter: { id: string; inputType: string }) => ({ parameterId: parameter.id, value: parameter.inputType === 'NUMBER' ? '150' : 'E2E OK' })));
    expect(results).toHaveLength(4);
    await request(app.getHttpServer()).patch(`/orders/${orderId}/results`).set(technicianAuth).send({ results }).expect(200);
    const entered = await request(app.getHttpServer()).get(`/orders/${orderId}/results`).set(technicianAuth).expect(200);
    expect(entered.body.items).toHaveLength(2);
    expect(entered.body.items.every((item: { results: unknown[] }) => item.results.length === 2)).toBe(true);
    expect(entered.body.items.flatMap((item: { results: Array<{ value: string; flag: string }> }) => item.results).filter((result) => result.value === '150').every((result) => result.flag === 'HIGH')).toBe(true);

    await request(app.getHttpServer()).post(`/orders/${orderId}/verify`).set(technicianAuth).expect(201);
    await request(app.getHttpServer()).post(`/orders/${orderId}/finalize`).set(technicianAuth).expect(201);
    const report = await request(app.getHttpServer()).get(`/orders/${orderId}/report`).set(technicianAuth).expect(200);
    expect(report.body.order.id).toBe(orderId);
    expect(report.body.order.tests).toHaveLength(2);
    expect(report.body.order.tests.every((item: { parameters: unknown[] }) => item.parameters.length === 2)).toBe(true);
    expect(report.body.reportNumber).toBeTruthy();

    const pdf = await request(app.getHttpServer()).get(`/orders/${orderId}/report/pdf`).set(technicianAuth).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    const pdfBuffer = Buffer.isBuffer(pdf.body) ? pdf.body : Buffer.from(pdf.body);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline');
    expect(pdf.headers['cache-control']).toContain('no-store');
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBuffer.subarray(-6).toString()).toContain('%%EOF');
    expect(pdfBuffer.toString('latin1')).toContain('/Type /Page');
  });

  it('logs out the refresh-token session and prevents reuse', async () => {
    await refreshAgent.post('/auth/logout').expect(200).expect({ success: true });
    await refreshAgent.post('/auth/refresh').expect(400);
  });
});
