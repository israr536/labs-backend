import { LabsService } from './labs.service';

describe('LabsService', () => {
  it('clears the laboratory logo when an empty icon is submitted', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'lab-1', icon: null });
    const service = new LabsService({
      lab: { update },
    } as never);

    await service.updateSettings({ labId: 'lab-1', role: 'ADMIN' } as never, { icon: '' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lab-1' },
      data: expect.objectContaining({ icon: null }),
    }));
  });
});
