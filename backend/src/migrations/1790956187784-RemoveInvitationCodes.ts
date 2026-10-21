import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveInvitationCodes1790956187784 implements MigrationInterface {
  name = 'RemoveInvitationCodes1790956187784';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys and invitation_codes table
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" DROP CONSTRAINT IF EXISTS "FK_e6c44819f9b3241db39d33613ac"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_invitation_codes_code"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "invitation_codes"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."invitation_codes_status_enum"`,
    );

    // Update existing users from PENDING_INVITE to ACTIVE
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'ACTIVE' WHERE "status" = 'PENDING_INVITE'`,
    );

    // Migrate enum
    await queryRunner.query(
      `ALTER TYPE "public"."users_status_enum" RENAME TO "users_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('ACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" TYPE "public"."users_status_enum" USING "status"::"text"::"public"."users_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum_old" AS ENUM('PENDING_INVITE', 'ACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" TYPE "public"."users_status_enum_old" USING "status"::"text"::"public"."users_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'PENDING_INVITE'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_status_enum_old" RENAME TO "users_status_enum"`,
    );
  }
}
