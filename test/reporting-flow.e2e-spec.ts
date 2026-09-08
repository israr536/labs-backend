import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(120_000);

describe('Reporting flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken = '';
  let labId = '';
  let patientId = '';
  let orderId = '';
  let testIds: string[] = [];
  let rawPassword = '';
  let email = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const unique = randomUUID();
    rawPassword = randomUUID();
    email = `e2e-${unique}@example.invalid`;
    const mobile = `9${String(Date.now()).slice(-9)}`;
    const now = new Date();

    const lab = await prisma.lab.create({
      data: {
        code: `E2E-${unique.slice(0, 8).toUpperCase()}`,
        name: 'E2E Laboratory',
        mobile,
        email,
        subscriptionPlan: 'TRIAL',
        subscriptionStartAt: now,
        subscriptionEndAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    labId = lab.id;

    await prisma.user.create({
      data: {
        labId,
        username: email,
        email,
        mobile,
        password: await bcrypt.hash(rawPassword, 10),
        role: UserRole.ADMIN,
      },
    });

    const parameterData = [
      { name: 'Result', inputType: 'NUMBER' as const, unit: 'mg/dL', normalMin: 1, normalMax: 100, displayOrder: 0, isRequired: true },
      { name: 'Comment', inputType: 'TEXT' as const, unit: null, normalMin: null, normalMax: null, displayOrder: 1, isRequired: true },
    ];
    const firstTest = await prisma.test.create({
      data: {
        labId,
        code: `E2E-A-${unique.slice(0, 8)}`,
        name: 'E2E Chemistry Test',
        category: 'E2E',
        department: 'CHEMISTRY',
        sampleType: 'SERUM',
        isActive: true,
        parameters: { create: parameterData },
      },
      include: { parameters: true },
    });
    const secondTest = await prisma.test.create({
      data: {
        labId,
        code: `E2E-B-${unique.slice(0, 8)}`,
        name: 'E2E Hematology Test',
        category: 'E2E',
        department: 'HEMATOLOGY',
        sampleType: 'BLOOD',
        isActive: true,
        parameters: { create: parameterData },
      },
      include: { parameters: true },
    });
    testIds = [firstTest.id, secondTest.id];

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: rawPassword })
      .expect(201);
    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    if (labId) await prisma.lab.delete({ where: { id: labId } }).catch(() => undefined);
    await app?.close();
  });

  it('runs patient registration through multi-test final report and PDF printing', async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };

    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set(auth)
      .send({ name: 'E2E Patient', age: 35, gender: 'MALE', mobile: '9000000001', email: 'patient@example.invalid' })
      .expect(201);
    patientId = patient.body.id;

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(auth)
      .send({ patientId, testIds, referredBy: 'E2E Doctor', clinicalNotes: 'E2E reporting flow' })
      .expect(201);
    orderId = order.body.id;
    expect(order.body.items).toHaveLength(2);

    const samples = await request(app.getHttpServer())
      .post(`/samples/orders/${orderId}`)
      .set(auth)
      .send({})
      .expect(201);
    expect(Array.isArray(samples.body)).toBe(true);
    for (const sample of samples.body) {
      for (const status of ['COLLECTED', 'RECEIVED', 'PROCESSING', 'COMPLETED']) {
        await request(app.getHttpServer())
          .patch(`/samples/${sample.id}/status`)
          .set(auth)
          .send({ status })
          .expect(200);
      }
    }

    const testDetails = await Promise.all(testIds.map((id) => request(app.getHttpServer()).get(`/tests/${id}`).set(auth).expect(200)));
    const results = testDetails.flatMap((response) => response.body.parameters.map((parameter: any) => ({
      parameterId: parameter.id,
      value: parameter.inputType === 'NUMBER' ? '50' : 'E2E OK',
    })));
    expect(results).toHaveLength(4);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/results`)
      .set(auth)
      .send({ results })
      .expect(200);

    const entered = await request(app.getHttpServer()).get(`/orders/${orderId}/results`).set(auth).expect(200);
    expect(entered.body.items).toHaveLength(2);
    expect(entered.body.items.every((item: any) => item.results.length === 2)).toBe(true);

    await request(app.getHttpServer()).post(`/orders/${orderId}/verify`).set(auth).expect(201);
    await request(app.getHttpServer()).post(`/orders/${orderId}/finalize`).set(auth).expect(201);

    const report = await request(app.getHttpServer()).get(`/orders/${orderId}/report`).set(auth).expect(200);
    expect(report.body.order.id).toBe(orderId);
    expect(report.body.order.tests).toHaveLength(2);
    expect(report.body.order.tests.every((item: any) => item.parameters.length === 2)).toBe(true);

    const pdf = await request(app.getHttpServer()).get(`/orders/${orderId}/report/pdf`).set(auth).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(100);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
