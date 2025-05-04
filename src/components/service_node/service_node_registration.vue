<template>
  <div class="service-node-registration">
    <div class="q-px-xl q-pt-md">
      <p class="tab-desc">
        {{ $t("strings.registrationStakingMigrationOxenToSessionToken") }}
        <span
          style="cursor: pointer; text-decoration: underline;"
          @click="oxenWebsiteHardfork11_2_0"
          >Oxen {{ $t("strings.website") }}.</span
        >
      </p>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";
import { required } from "vuelidate/lib/validators";
import WalletPassword from "src/mixins/wallet_password";

export default {
  name: "ServiceNodeRegistration",
  mixins: [WalletPassword],
  data() {
    return {
      registration_string: ""
    };
  },
  computed: mapState({
    theme: state => state.gateway.app.config.appearance.theme,
    registration_status: state => state.gateway.service_node_status.registration
  }),
  validations: {
    registration_string: { required }
  },
  watch: {
    registration_status: {
      handler(val, old) {
        if (val.code == old.code) return;
        const { code, message } = val;
        switch (code) {
          case 0:
            this.$q.notify({
              type: "positive",
              timeout: 1000,
              message
            });
            this.$v.$reset();
            this.registration_string = "";
            break;
          case -1:
            this.$q.notify({
              type: "negative",
              timeout: 3000,
              message
            });
            break;
        }
      },
      deep: true
    }
  },
  methods: {
    oxenWebsiteHardfork11_2_0() {
      const url = "https://oxen.io/blog/oxen-anchor-hardfork-11-2-0";
      this.$gateway.send("core", "open_url", {
        url
      });
    },
    async register() {
      this.$v.registration_string.$touch();

      if (this.$v.registration_string.$error) {
        this.$q.notify({
          type: "negative",
          timeout: 1000,
          message: this.$t("notification.errors.invalidServiceNodeCommand")
        });
        return;
      }

      let passwordDialog = await this.showPasswordConfirmation({
        title: this.$t("dialog.registerServiceNode.title"),
        noPasswordMessage: this.$t("dialog.registerServiceNode.message"),
        ok: {
          label: this.$t("dialog.registerServiceNode.ok"),
          color: "primary"
        },
        dark: this.theme == "dark",
        color: this.theme == "dark" ? "white" : "dark"
      });
      passwordDialog
        .onOk(password => {
          // in case of no password
          password = password || "";
          this.$store.commit("gateway/set_snode_status", {
            registration: {
              code: 1,
              message: "Registering...",
              sending: true
            }
          });
          this.$gateway.send("wallet", "register_service_node", {
            password,
            string: this.registration_string.trim()
          });
        })
        .onDismiss(() => {})
        .onCancel(() => {});
    },
    onPaste() {
      this.$nextTick(() => {
        this.registration_string = this.registration_string.trim();
      });
    }
  }
};
</script>

<style lang="scss">
.register-button {
  margin-top: 6px;
}
</style>
