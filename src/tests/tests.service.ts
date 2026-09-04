import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ParameterInputType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import {
  arrayValue,
  enumValue,
  optionalBoolean,
  optionalInteger,
  optionalNumber,
  optionalString,
  requiredString,
} from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';

interface TestBody {
  code?: unknown;
  shortName?: unknown;
  name?: unknown;
  category?: unknown;
  department?: unknown;
  sampleType?: unknown;
  price?: unknown;
  tat?: unknown;
  method?: unknown;
  remarks?: unknown;
  isActive?: unknown;
  parameters?: unknown;
}

interface ParameterBody {
  name?: unknown;
  inputType?: unknown;
  unit?: unknown;
  normalMin?: unknown;
  normalMax?: unknown;
  displayOrder?: unknown;
  isRequired?: unknown;
}

@Injectable()
export class TestsService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptionService: SubscriptionService) {}

  async create(currentUser: AuthUser, body: TestBody) {
    if (optionalBoolean(body.isActive, 'isActive') !== false) {
      await this.subscriptionService.assertWithinLimit(currentUser.labId, 'tests');
    }
    const parameters = this.parseParameters(body.parameters, false);

    return this.prisma.test.create({
      data: {
        labId: currentUser.labId,
        code: requiredString(body.code, 'code'),
        shortName: optionalString(body.shortName, 'shortName'),
        name: requiredString(body.name, 'name'),
        category: optionalString(body.category, 'category'),
        department: optionalString(body.department, 'department'),
        sampleType: optionalString(body.sampleType, 'sampleType'),
        price: optionalNumber(body.price, 'price'),
        tat: optionalInteger(body.tat, 'tat'),
        method: optionalString(body.method, 'method'),
        remarks: optionalString(body.remarks, 'remarks'),
        isActive: optionalBoolean(body.isActive, 'isActive') ?? true,
        parameters: parameters.length ? { create: parameters } : undefined,
      },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  findAll(currentUser: AuthUser, includeInactive?: string) {
    return this.prisma.test.findMany({
      where: {
        labId: currentUser.labId,
        ...(includeInactive === 'true' ? {} : { isActive: true }),
      },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const test = await this.prisma.test.findFirst({
      where: { id, labId: currentUser.labId },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!test) throw new NotFoundException('Test not found');
    return test;
  }

  async update(currentUser: AuthUser, id: string, body: TestBody) {
    await this.findOne(currentUser, id);
    const parameters = body.parameters === undefined ? undefined : this.parseParameters(body.parameters, true);
    if (parameters) {
      const resultCount = await this.prisma.reportResult.count({ where: { parameter: { testId: id } } });
      if (resultCount > 0) throw new BadRequestException('Cannot replace parameters after reports have results');
    }
    return this.prisma.test.update({
      where: { id },
      data: {
        code: body.code === undefined ? undefined : requiredString(body.code, 'code'),
        shortName: optionalString(body.shortName, 'shortName'),
        name: body.name ? requiredString(body.name, 'name') : undefined,
        category: optionalString(body.category, 'category'),
        department: optionalString(body.department, 'department'),
        sampleType: optionalString(body.sampleType, 'sampleType'),
        price: optionalNumber(body.price, 'price'),
        tat: optionalInteger(body.tat, 'tat'),
        method: optionalString(body.method, 'method'),
        remarks: optionalString(body.remarks, 'remarks'),
        isActive: optionalBoolean(body.isActive, 'isActive'),
        ...(parameters ? { parameters: { deleteMany: {}, create: parameters } } : {}),
      },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  async addParameter(currentUser: AuthUser, testId: string, body: ParameterBody) {
    await this.findOne(currentUser, testId);
    return this.prisma.testParameter.create({ data: { testId, ...this.parseParameter(body, 0) } });
  }

  async updateParameter(currentUser: AuthUser, testId: string, parameterId: string, body: ParameterBody) {
    await this.findOne(currentUser, testId);
    const parameter = await this.prisma.testParameter.findFirst({ where: { id: parameterId, testId } });
    if (!parameter) throw new NotFoundException('Parameter not found');
    return this.prisma.testParameter.update({ where: { id: parameterId }, data: {
      name: body.name ? requiredString(body.name, 'name') : undefined,
      inputType: body.inputType ? enumValue(ParameterInputType, body.inputType, 'inputType') : undefined,
      unit: optionalString(body.unit, 'unit'), normalMin: optionalNumber(body.normalMin, 'normalMin'), normalMax: optionalNumber(body.normalMax, 'normalMax'), displayOrder: optionalInteger(body.displayOrder, 'displayOrder'), isRequired: optionalBoolean(body.isRequired, 'isRequired'),
    } });
  }

  async removeParameter(currentUser: AuthUser, testId: string, parameterId: string) {
    await this.findOne(currentUser, testId);
    const resultCount = await this.prisma.reportResult.count({ where: { parameterId } });
    if (resultCount > 0) throw new BadRequestException('Cannot delete a parameter used in reports');
    await this.prisma.testParameter.delete({ where: { id: parameterId, testId } });
    return { success: true };
  }

  async remove(currentUser: AuthUser, id: string) {
    await this.findOne(currentUser, id);
    await this.prisma.test.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  private parseParameters(value: unknown, replace: boolean) {
    if (value === undefined || value === null) return [];
    const parameters = arrayValue<ParameterBody>(value, 'parameters');
    if (replace && parameters.length === 0) return [];
    return parameters.map((parameter, index) => this.parseParameter(parameter, index));
  }

  private parseParameter(parameter: ParameterBody, index: number) {
    return {
      name: requiredString(parameter.name, `parameters.${index}.name`),
      inputType: parameter.inputType === undefined ? ParameterInputType.NUMBER : enumValue(ParameterInputType, parameter.inputType, `parameters.${index}.inputType`),
      unit: optionalString(parameter.unit, `parameters.${index}.unit`),
      normalMin: optionalNumber(parameter.normalMin, `parameters.${index}.normalMin`),
      normalMax: optionalNumber(parameter.normalMax, `parameters.${index}.normalMax`),
      displayOrder: optionalInteger(parameter.displayOrder, `parameters.${index}.displayOrder`) ?? index,
      isRequired: optionalBoolean(parameter.isRequired, `parameters.${index}.isRequired`) ?? true,
    };
  }
}
