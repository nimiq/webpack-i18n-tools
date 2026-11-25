<template>
    <div class="greeting" :title="$t('Greeting title')">
        <h1>{{ $t('Hello {name}', { name }) }}</h1>
        <p>{{ $tc('{count} new message | {count} new messages', count) }} and {{ $t('Second on line') }}</p>
        <img src="logo.svg" :alt="$t('Logo')">
        <button @click="notify($t('Clicked'))">{{
            $t('Multiline interpolation')
        }}</button>
        <input v-model="value" :placeholder="$t('Placeholder')"/>
        <i18n path="Read the {terms}" tag="p">
            <a slot="terms">{{ $t('terms') }}</a>
        </i18n>
        <i18n-t keypath="Keypath with 'quote'" tag="p"></i18n-t>
        <i18n-t :keypath="dynamic ? 'Dynamic keypath' : 'Other keypath'" tag="p"></i18n-t>
        <p v-if="$te('Exists check')">{{ $t('Shared message') }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
    computed: {
        label(): string {
            return this.$t('Label from script') as string;
        },
        context() {
            return this.$root.$tc('Root plural | Root plurals', 2);
        },
    },
});
</script>

<style>
.greeting { color: red; }
</style>
