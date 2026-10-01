import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeInvitationCodeCreatorIdNullable1790852794320 implements MigrationInterface {
  name = 'MakeInvitationCodeCreatorIdNullable1790852794320';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" DROP CONSTRAINT "FK_e6c44819f9b3241db39d33613ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" ALTER COLUMN "creator_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" ADD CONSTRAINT "FK_e6c44819f9b3241db39d33613ac" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" DROP CONSTRAINT "FK_e6c44819f9b3241db39d33613ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" ALTER COLUMN "creator_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" ADD CONSTRAINT "FK_e6c44819f9b3241db39d33613ac" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
