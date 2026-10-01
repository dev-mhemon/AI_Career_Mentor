import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase1CreateUsersAndInvitationCodes1790852026539 implements MigrationInterface {
  name = 'Phase1CreateUsersAndInvitationCodes1790852026539';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('PENDING_INVITE', 'ACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "supabase_uid" character varying(255) NOT NULL, "email" character varying(255), "phone" character varying(50), "role" "public"."users_role_enum" NOT NULL DEFAULT 'USER', "status" "public"."users_status_enum" NOT NULL DEFAULT 'PENDING_INVITE', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a24a1a3c0431ec2d97a5df520db" UNIQUE ("supabase_uid"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_email" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_phone" ON "users"  ("phone") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."invitation_codes_status_enum" AS ENUM('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invitation_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(100) NOT NULL, "creator_id" uuid NOT NULL, "usage_limit" integer NOT NULL, "used_count" integer NOT NULL DEFAULT '0', "expiration_date" TIMESTAMP WITH TIME ZONE, "status" "public"."invitation_codes_status_enum" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c65104e572ae7ecb20993ccb0dd" UNIQUE ("code"), CONSTRAINT "PK_707eabf9705bec823c436dfa264" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_invitation_codes_code" ON "invitation_codes"  ("code") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" ADD CONSTRAINT "FK_e6c44819f9b3241db39d33613ac" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitation_codes" DROP CONSTRAINT "FK_e6c44819f9b3241db39d33613ac"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_invitation_codes_code"`);
    await queryRunner.query(`DROP TABLE "invitation_codes"`);
    await queryRunner.query(
      `DROP TYPE "public"."invitation_codes_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_phone"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
