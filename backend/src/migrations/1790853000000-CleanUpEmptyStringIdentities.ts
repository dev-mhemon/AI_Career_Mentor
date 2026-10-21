import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanUpEmptyStringIdentities1790853000000 implements MigrationInterface {
  name = 'CleanUpEmptyStringIdentities1790853000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert empty strings to NULL for unique nullable columns
    await queryRunner.query(
      "UPDATE users SET phone = NULL WHERE TRIM(phone) = '';",
    );
    await queryRunner.query(
      "UPDATE users SET email = NULL WHERE TRIM(email) = '';",
    );
  }

  public async down(): Promise<void> {
    // Reversal is not safely possible without knowing which ones were originally empty string vs naturally NULL,
    // but we can leave them as NULL since NULL is the correct semantic value.
  }
}
